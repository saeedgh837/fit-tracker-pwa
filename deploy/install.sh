#!/usr/bin/env bash
#
# Hamgam | automated installer for Ubuntu/Debian with nginx and TLS
#
# Quick start:
#   sudo bash deploy/install.sh
#
# Non-interactive (for CI or re-installs):
#   sudo bash deploy/install.sh --non-interactive \
#     --domain fit.example.com --email me@example.com --yes
#
# Update an existing install:
#   sudo bash deploy/install.sh --update
#
# Roll back to the previous release:
#   sudo bash deploy/install.sh --rollback
#
# -- Deployment layout -----------------------------------------------------
# Files are never copied onto the live release. Each run builds a complete,
# independent release and, at the end, swaps a symlink atomically:
#
#   <webroot>/releases/20261019-010203-a1b2c3d   <- a complete release
#   <webroot>/current -> releases/...            <- atomic symlink (nginx root)
#   <webroot>/.previous                          <- previous release, for rollback
#
# So a half-copied tree is never live, tabs still running the previous
# release keep resolving its hashed assets (they are carried into the new
# release), and the previous release remains available for manual rollback.
# Unexpected command failures after a swap also attempt an automatic rollback.
#
# Re-running the script reuses existing settings and services.

set -Eeuo pipefail

readonly SCRIPT_VERSION='2.2.0'
readonly APP_NAME='Hamgam'
readonly REPO_URL_DEFAULT='https://github.com/saeedgh837/fit-tracker-pwa.git'
readonly CONF_DIR='/etc/hamgam'
readonly CONF_FILE="$CONF_DIR/install.conf"
readonly LOG_FILE='/var/log/hamgam-install.log'
readonly NGINX_SITE='/etc/nginx/sites-available/hamgam'
readonly NGINX_LINK='/etc/nginx/sites-enabled/hamgam'
readonly HEADERS_SNIPPET='/etc/nginx/snippets/hamgam-headers.conf'
readonly CACHE_MAP='/etc/nginx/conf.d/hamgam-cache.conf'
readonly LOCK_FILE='/run/lock/hamgam-install.lock'
readonly NODE_MAJOR='22'
readonly RELEASES_KEEP=3
readonly TOTAL_STEPS=10

# -------------------------------------------------------------- colors ----
# Colour only when writing to a real terminal and NO_COLOR is unset.
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != 'dumb' ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[38;5;203m'
  C_GREEN=$'\033[38;5;78m'
  C_YELLOW=$'\033[38;5;221m'
  C_CYAN=$'\033[38;5;80m'
  C_TEAL=$'\033[38;5;37m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_CYAN='' C_TEAL=''
fi
readonly C_RESET C_BOLD C_DIM C_RED C_GREEN C_YELLOW C_CYAN C_TEAL


# ------------------------------------------------------- printing & log ----
LOG_READY=0
# Points at /dev/null from the start so any line that runs before init_log can
# still use the 2>>$LOG_PATH redirections. Without this, a failed redirect
# would kill the script under set -e, not just lose the log line.
LOG_PATH=/dev/null
init_log() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  if : >"$LOG_FILE" 2>/dev/null; then
    LOG_READY=1
    LOG_PATH=$LOG_FILE
  fi
  if [[ $LOG_READY -eq 1 ]]; then
    {
      printf 'Hamgam installer v%s | %s\n' "$SCRIPT_VERSION" "$(date -Is)"
      printf 'command: %s\n\n' "$*"
    } >>"$LOG_PATH"
  fi
}
log() {
  [[ $LOG_READY -eq 1 ]] || return 0
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG_PATH"
  return 0
}

ui_out() { printf '%b\n' "$*"; log "$(printf '%s' "$*" | sed 's/\x1b\[[0-9;]*m//g')"; }
plain() { ui_out "${C_RESET}$*${C_RESET}"; }
ok() { ui_out "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { ui_out "${C_YELLOW}  ▲${C_RESET} $*"; }
note() { ui_out "${C_DIM}    $*${C_RESET}"; }
bad() { ui_out "${C_RED}  ✗${C_RESET} $*"; }

hr() { ui_out "${C_DIM}  ────────────────────────────────────────────────────────────${C_RESET}"; }

panel_row() {
  local color=$1 text=$2 row
  printf -v row '  %-56s' "$text"
  ui_out "${color}   │${row}│${C_RESET}"
}

banner() {
  ui_out ''
  ui_out "${C_TEAL}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
  panel_row "${C_TEAL}${C_BOLD}" "$APP_NAME  server installer"
  panel_row "$C_TEAL" 'Daily health app / local browser data / offline'
  ui_out "${C_TEAL}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
  ui_out "${C_DIM}    installer v$SCRIPT_VERSION / log: $LOG_FILE${C_RESET}"
  ui_out ''
}

STEP_INDEX=0
step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  ui_out ''
  ui_out "${C_CYAN}${C_BOLD}  > step $STEP_INDEX of $TOTAL_STEPS: $*${C_RESET}"
  hr
}

# ------------------------------------------------- stopping on failure ----
# One place ends an install, whichever frame noticed the failure. A failure
# reported deeper down comes back through an OR-list, and a status that arrives
# that way must still roll a live release back and still print exactly one
# closing banner. So the status travels, the rollback happens here, and the
# frame below says nothing about stopping: this is the frame that stops it.
STOPPING=0
STOP_STATUS=0
stop_install() {
  local status=${1:-1}

  # A second failure while already stopping — most often the rollback below
  # failing on an already-broken system — must not replace the status that
  # explains the install, and must not stop the first call from finishing.
  [[ $STOPPING -eq 0 ]] || exit "$STOP_STATUS"
  STOPPING=1
  STOP_STATUS=$status

  ui_out ''
  ui_out "${C_RED}${C_BOLD}  Installation stopped.${C_RESET}"
  ui_out "  ${C_DIM}Review the live release before retrying. Use --rollback to restore the previous release if needed.${C_RESET}"
  if [[ $LOG_READY -eq 1 ]]; then ui_out "  ${C_DIM}full log: $LOG_FILE${C_RESET}"; fi

  # Rollback last, and after the banner: an install that already swapped the
  # release in has put something unproven in front of users, so it goes back.
  # The default matters: this can run before SWAP_DONE is initialised. A failing
  # rollback reports itself and exits, and the status above still wins.
  if [[ ${SWAP_DONE:-0} -eq 1 ]]; then
    warn 'The new release was already live; rolling back to the previous one...'
    rollback_deploy || true
  fi
  exit "$STOP_STATUS"
}

die() {
  local message=$1 status=${2:-1}
  bad "$message"
  # In a subshell this only ends the subshell; the caller sees the status and
  # calls stop_install, which is the frame that can actually stop the install.
  if [[ $BASH_SUBSHELL -gt 0 ]]; then
    log "SUBSHELL FAILURE (exit $status): $message"
    exit "$status"
  fi
  stop_install "$status"
}

on_error() {
  local code=$1 line=$2 cmd=$3

  # A failing command substitution (or `( ... )`) runs this in a subshell. There
  # it must end that subshell, not just report and return: returning would let
  # the assignment finish with whatever it produced and the install run on with
  # a value nobody checked. Set -e still stops the parent, which reports it.
  if [[ $BASH_SUBSHELL -gt 0 ]]; then
    bad "A helper command failed in a subshell (exit $code): $cmd"
    log "SUBSHELL ERROR line $line: $cmd (exit $code)"
    exit "$code"
  fi

  bad "Command failed with exit code $code"
  note "line $line: $cmd"
  stop_install "$code"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

# --------------------------------------------------------- owned resources ----
# A data-only journal of resources actually created, never an executable shell file.
readonly OWN_FILE="$CONF_DIR/owned.tsv"
INVENTORY_ACTIVE=0
OWN_TYPES=() OWN_PATHS=() OWN_IDS=() OWN_HASHES=()
UNINSTALL_ONLY=0 DRY_RUN=0 ADOPT_LEGACY=0

safe_owned_path() { [[ $1 =~ ^/[a-zA-Z0-9_./-]+$ && $1 != *..* && $1 != *//* && $1 != */./* && $1 != */ ]]; }

protected_ancestry() {
  local current=$1 owner mode
  while :; do
    [[ ! -L $current ]] || return 1
    if [[ -e $current ]]; then
      read -r owner mode < <(stat -c '%u %a' -- "$current") || return 1
      [[ $owner == 0 && $mode =~ ^[0-7]{3,4}$ ]] || return 1
      if (( (8#$mode & 0022) != 0 )); then
        [[ -d $current ]] && (( (8#$mode & 01000) != 0 )) || return 1
      fi
    fi
    [[ $current == / ]] && break
    current=$(dirname -- "$current") || return 1
  done
}

guard_removal_path() {
  local path=$1 current target mounts
  safe_owned_path "$path" || die "Unsafe removal path: $path"
  case $path in
    /|/etc|/etc/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/lib|/lib/*|/lib64|/lib64/*|/boot|/boot/*|/dev|/dev/*|/proc|/proc/*|/sys|/sys/*|/run|/run/*|/root|/root/*|/var|/var/www|/var/log|/var/log/*|/var/lib|/var/lib/*|/opt|/srv|/home|/home/[^/]*|/tmp|/mnt|/media)
      die "Protected removal path: $path" ;;
  esac
  current=$path
  while :; do
    [[ ! -L $current ]] || die "Symlink in removal path: $current"
    [[ $current == / ]] && break
    current=$(dirname -- "$current") || die 'Cannot inspect removal path.'
  done
  [[ $(readlink -m -- "$path") == "$path" ]] || die 'Non-canonical removal path.'
  # Same-device bind mounts also need protection; do not rely only on rm -xdev.
  have findmnt || die 'findmnt is required for safe removal.'
  mounts=$(findmnt -rn -o TARGET) || die 'Cannot determine mount boundaries.'
  while IFS= read -r target; do
    [[ $target != "$path" && $target != "$path/"* ]] || die "Mounted filesystem inside removal path: $target"
  done <<<"$mounts"
  protected_ancestry "$(dirname -- "$path")" || die 'Untrusted removal path ancestry.'
}

owned_fingerprint() {
  if [[ $1 == link ]]; then readlink -- "$2" | sha256sum | cut -d' ' -f1
  elif [[ $1 == file ]]; then sha256sum -- "$2" | cut -d' ' -f1
  else printf -- '-\n'; fi
}

inventory_load() {
  OWN_TYPES=() OWN_PATHS=() OWN_IDS=() OWN_HASHES=()
  [[ -e $OWN_FILE || -L $OWN_FILE ]] || return 0
  if [[ ! -f $OWN_FILE || -L $OWN_FILE ]] || ! protected_ancestry "$OWN_FILE"; then die 'Untrusted ownership inventory.'; fi
  local header kind path identity digest rest
  { read -r header
    [[ $header == HAMGAM_OWNED_V1 ]] || die 'Unsupported ownership inventory version.'
    while IFS=$'\t' read -r kind path identity digest rest; do
      [[ -z $rest && $identity =~ ^[0-9]+:[0-9]+$ ]] || die 'Malformed ownership record.'
      safe_owned_path "$path" || die 'Invalid ownership path.'
      case $kind in tree|empty|file|link|log) ;; *) die 'Invalid ownership record type.' ;; esac
      if [[ $kind == tree || $kind == empty ]]; then
        (guard_removal_path "$path") || die 'Unsafe ownership directory.'
        [[ $digest == - ]] || die 'Malformed ownership directory digest.'
      else
        case $path in
          "$NGINX_SITE"|"$NGINX_LINK"|"$HEADERS_SNIPPET"|"$CACHE_MAP"|"$CONF_FILE"|"$LOG_FILE"|"$CONF_DIR"/*|/var/log/nginx/hamgam.access.log|/var/log/nginx/hamgam.error.log) ;;
          *) (guard_removal_path "$(dirname "$path")") || die 'Unsafe owned file parent.' ;;
        esac
        if [[ $kind == log ]]; then
          case $path in "$LOG_FILE"|/var/log/nginx/hamgam.access.log|/var/log/nginx/hamgam.error.log) ;; *) die 'Invalid owned log path.' ;; esac
          [[ $digest == - ]] || die 'Malformed log record.'
        else [[ $digest =~ ^[a-f0-9]{64}$ ]] || die 'Malformed ownership digest.'; fi
      fi
      OWN_TYPES+=("$kind") OWN_PATHS+=("$path") OWN_IDS+=("$identity") OWN_HASHES+=("$digest")
    done
  } <"$OWN_FILE"
}

inventory_record() {
  local kind=$1 path=$2 identity digest tmp i
  safe_owned_path "$path" || die "Cannot record unsafe path: $path"
  mkdir -p "$CONF_DIR" || die 'Cannot create ownership directory.'
  chmod 700 "$CONF_DIR"
  protected_ancestry "$CONF_DIR" || die 'Unsafe ownership directory.'
  inventory_load
  identity=$(stat -c '%d:%i' -- "$path") || die 'Cannot record resource identity.'
  digest=$(owned_fingerprint "$kind" "$path") || die 'Cannot record resource digest.'
  tmp=$(mktemp "$CONF_DIR/.owned.XXXXXXXX") || die 'Cannot stage ownership inventory.'
  chmod 600 "$tmp"
  printf 'HAMGAM_OWNED_V1\n' >"$tmp"
  for i in "${!OWN_PATHS[@]}"; do
    [[ ${OWN_PATHS[i]} == "$path" ]] && continue
    printf '%s\t%s\t%s\t%s\n' "${OWN_TYPES[i]}" "${OWN_PATHS[i]}" "${OWN_IDS[i]}" "${OWN_HASHES[i]}" >>"$tmp"
  done
  printf '%s\t%s\t%s\t%s\n' "$kind" "$path" "$identity" "$digest" >>"$tmp"
  mv -f -- "$tmp" "$OWN_FILE" || die 'Cannot commit ownership inventory.'
}

record_if_installing() { [[ $INVENTORY_ACTIVE -eq 1 ]] || return 0; inventory_record "$@"; }

inventory_begin() {
  INVENTORY_ACTIVE=1
  mkdir -p "$CONF_DIR"
  chmod 700 "$CONF_DIR"
  protected_ancestry "$CONF_DIR" || die 'Unsafe configuration directory.'
  inventory_load
}

record_nginx_resources() {
  local path
  [[ $INVENTORY_ACTIVE -eq 1 ]] || return 0
  for path in "$NGINX_SITE" "$HEADERS_SNIPPET" "$CACHE_MAP"; do
    [[ ! -f $path ]] || inventory_record file "$path"
  done
  [[ ! -L $NGINX_LINK ]] || inventory_record link "$NGINX_LINK"
}

# Parse the legacy settings as data, never source/eval during an uninstall.
legacy_setting() {
  local name=$1 line value
  [[ -f $CONF_FILE && ! -L $CONF_FILE ]] && protected_ancestry "$CONF_FILE" || return 1
  while IFS= read -r line; do
    [[ $line == "$name="* ]] || continue
    value=${line#*=}
    if [[ $value == \'*\' ]]; then value=${value:1:${#value}-2}; fi
    [[ $value =~ ^[a-zA-Z0-9_./:@-]+$ ]] || return 1
    printf '%s\n' "$value"
    return 0
  done <"$CONF_FILE"
  return 1
}

PLAN_TYPES=() PLAN_PATHS=() PLAN_IDS=() PLAN_HASHES=()
UNPROVEN=0
build_uninstall_plan() {
  inventory_load
  PLAN_TYPES=() PLAN_PATHS=() PLAN_IDS=() PLAN_HASHES=() UNPROVEN=0
  local i path actual digest kind
  if [[ ! -e $OWN_FILE ]]; then
    # No journal means no recursive deletion by guessing. Explicit legacy adoption
    # below requires installation-specific evidence, not just a plausible name.
    build_legacy_uninstall_plan
    return
  fi
  for i in "${!OWN_PATHS[@]}"; do
    path=${OWN_PATHS[i]} kind=${OWN_TYPES[i]}
    [[ -e $path || -L $path ]] || continue
    actual=$(stat -c '%d:%i' -- "$path") || die 'Cannot inspect an owned resource.'
    digest=$(owned_fingerprint "$kind" "$path") || die 'Cannot inspect an owned resource digest.'
    if [[ $actual != "${OWN_IDS[i]}" || $digest != "${OWN_HASHES[i]}" ]]; then
      warn "Retaining changed/unproven resource: $path"
      UNPROVEN=1
      continue
    fi
    PLAN_TYPES+=("$kind") PLAN_PATHS+=("$path") PLAN_IDS+=("$actual") PLAN_HASHES+=("$digest")
  done
}

add_legacy_candidate() {
  local kind=$1 path=$2
  [[ -e $path || -L $path ]] || return 0
  PLAN_TYPES+=("$kind") PLAN_PATHS+=("$path")
  PLAN_IDS+=("$(stat -c '%d:%i' -- "$path")")
  PLAN_HASHES+=("$(owned_fingerprint "$kind" "$path")")
}

build_legacy_uninstall_plan() {
  local web='' repo='' source='' path candidate good=0
  if [[ -f $CONF_FILE ]]; then
    web=$(legacy_setting CFG_WEBROOT) || true
    repo=$(legacy_setting CFG_REPO_DIR) || true
    source=$(legacy_setting CFG_SOURCE) || true
  fi
  if [[ -n $web && -f $NGINX_SITE ]] &&
     grep -q '^# Generated by deploy/install.sh' "$NGINX_SITE" &&
     grep -Fq "root $web/current;" "$NGINX_SITE"; then
    (guard_removal_path "$web") || die 'Legacy webroot is not safe to remove.'
    # Never adopt a mixed-use webroot. Every release must be this app's bundle.
    good=1
    for path in "$web"/* "$web"/.[!.]*; do
      [[ -e $path || -L $path ]] || continue
      case ${path##*/} in current|.previous|releases) ;; *) good=0 ;; esac
    done
    if [[ ! -L $web/current || $(readlink -f "$web/current") != "$web/releases/"* ]]; then good=0; fi
    for candidate in "$web"/releases/*; do
      [[ -d $candidate && ! -L $candidate && -f $candidate/index.html && -f $candidate/sw.js && -f $candidate/manifest.webmanifest ]] || { good=0; break; }
      grep -q 'id="root"' "$candidate/index.html" && grep -q 'precacheAndRoute\|workbox' "$candidate/sw.js" || good=0
    done
    if [[ $good -eq 1 && $ADOPT_LEGACY -eq 1 ]]; then
      add_legacy_candidate tree "$web"
    else warn "Legacy webroot retained (use --adopt-legacy only after reviewing it): $web"; UNPROVEN=1; fi
    for path in "$NGINX_SITE" "$HEADERS_SNIPPET" "$CACHE_MAP"; do
      if [[ -f $path ]] && grep -q '^# Generated by deploy/install.sh' "$path"; then
        if [[ $ADOPT_LEGACY -eq 1 ]]; then add_legacy_candidate file "$path"; else UNPROVEN=1; fi
      fi
    done
    if [[ -L $NGINX_LINK && $(readlink -f "$NGINX_LINK") == "$NGINX_SITE" && $ADOPT_LEGACY -eq 1 ]]; then add_legacy_candidate link "$NGINX_LINK"; fi
  elif [[ -e $NGINX_SITE || -n $web ]]; then
    warn 'Legacy site ownership cannot be proven; no site directories will be deleted.'
    UNPROVEN=1
  fi
  if [[ $source == git && -n $repo && -d $repo/.git ]]; then
    if [[ $ADOPT_LEGACY -eq 1 ]] &&
       grep -q '"name": "fit-tracker-pwa"' "$repo/package.json" &&
       git -c safe.directory="$repo" -C "$repo" remote get-url origin 2>/dev/null | grep -Eq '(^https://github.com/saeedgh837/fit-tracker-pwa(\.git)?$|^git@github.com:saeedgh837/fit-tracker-pwa\.git$)'; then
      (guard_removal_path "$repo") || die 'Unsafe legacy clone path.'
      add_legacy_candidate tree "$repo"
    else warn "Unproven/legacy clone retained: $repo"; UNPROVEN=1; fi
  fi
  if [[ -f $CONF_FILE ]]; then
    if [[ $ADOPT_LEGACY -eq 1 ]] && grep -q '^# Hamgam install settings;' "$CONF_FILE"; then add_legacy_candidate file "$CONF_FILE"
    else warn "Legacy settings retained: $CONF_FILE"; UNPROVEN=1; fi
  fi
}

# No automatic swapoff: even uninstalling under memory pressure must stay safe.
report_preserved_resources() {
  note 'Preserved: external certificates/keys, local sources, prebuilt inputs, shared packages, other sites, Xray and firewall rules.'
  if [[ -e /var/lib/hamgam-build-swap || -L /var/lib/hamgam-build-swap ]]; then
    warn 'Swap retained at /var/lib/hamgam-build-swap; no swapoff or fstab changes were made.'
  fi
}

recheck_removal_record() {
  local i=$1 path=${PLAN_PATHS[$1]} kind=${PLAN_TYPES[$1]}
  [[ -e $path || -L $path ]] || return 0
  [[ $(stat -c '%d:%i' -- "$path") == "${PLAN_IDS[i]}" && $(owned_fingerprint "$kind" "$path") == "${PLAN_HASHES[i]}" ]] || die "Resource changed during uninstall: $path"
  if [[ $kind == tree || $kind == empty ]]; then guard_removal_path "$path"; fi
}

run_uninstall() {
  local i path kind pid quarantine='' active=0 failed=0 worker pids='' attempt
  build_uninstall_plan
  plain 'Hamgam uninstall plan:'
  for i in "${!PLAN_PATHS[@]}"; do plain "  Remove ${PLAN_TYPES[i]}: ${PLAN_PATHS[i]}"; done
  report_preserved_resources
  [[ $ADOPT_LEGACY -eq 0 ]] || warn 'Legacy adoption explicitly requested; reviewed clone/release content will be deleted, including local modifications.'
  if [[ $DRY_RUN -eq 1 ]]; then note 'Dry run only. No resources changed.'; [[ $UNPROVEN -eq 0 ]]; return; fi
  if [[ $NON_INTERACTIVE -eq 1 && $ASSUME_YES -ne 1 ]]; then die 'Uninstall requires --yes in non-interactive mode.'; fi
  if [[ ${#PLAN_PATHS[@]} -eq 0 && $UNPROVEN -eq 0 && ! -e $OWN_FILE ]]; then ok 'No managed Hamgam installation found.'; return 0; fi
  ask_yes_no 'Permanently remove the listed Hamgam resources?' n || { note 'Uninstall cancelled. No resources changed.'; return 0; }
  [[ $UNPROVEN -eq 0 ]] || die 'Uninstall incomplete: unproven resources retained. Review them; --yes does not adopt legacy paths.'
  for i in "${!PLAN_PATHS[@]}"; do recheck_removal_record "$i"; done
  # A key stored within a removable tree must never disappear as collateral.
  local cert='' key='' target root
  cert=$(legacy_setting CFG_TLS_CERT) || true
  key=$(legacy_setting CFG_TLS_KEY) || true
  for target in "$cert" "$key"; do
    [[ -n $target ]] || continue
    target=$(readlink -m -- "$target") || die 'Cannot resolve preserved certificate path.'
    for i in "${!PLAN_PATHS[@]}"; do
      root=${PLAN_PATHS[i]}
      [[ ${PLAN_TYPES[i]} != tree || ( $target != "$root" && $target != "$root/"* ) ]] || die 'A preserved certificate is inside a removal tree; move it outside first.'
    done
  done
  # Validate and detach nginx config before removing anything it may still serve.
  local has_nginx=0
  for path in "${PLAN_PATHS[@]}"; do
    case $path in "$NGINX_SITE"|"$NGINX_LINK"|"$HEADERS_SNIPPET"|"$CACHE_MAP") has_nginx=1 ;; esac
  done
  if [[ $has_nginx -eq 1 ]]; then
    have nginx || die 'nginx config exists but nginx is unavailable; restore the tool before uninstalling.'
    nginx -t >>"$LOG_PATH" 2>&1 || die 'Existing nginx configuration is invalid; nothing removed.'
    systemctl is-active --quiet nginx && active=1
    quarantine=$(mktemp -d /tmp/hamgam-uninstall.XXXXXXXX) || die 'Cannot stage nginx removal.'
    chmod 700 "$quarantine"
    for path in "${PLAN_PATHS[@]}"; do
      case $path in
        "$NGINX_SITE"|"$NGINX_LINK"|"$HEADERS_SNIPPET"|"$CACHE_MAP")
          mkdir -p "$quarantine$(dirname "$path")"
          mv -- "$path" "$quarantine$path" || { failed=1; break; } ;;
      esac
    done
    if [[ $failed -eq 0 ]] && ! nginx -t >>"$LOG_PATH" 2>&1; then failed=1; fi
    if [[ $failed -eq 0 && $active -eq 1 ]]; then
      pids=$(pgrep -f '^nginx: worker process' || true)
      systemctl reload nginx >>"$LOG_PATH" 2>&1 || failed=1
      # Graceful reload: old workers may still reference the removed release.
      for ((attempt=0; attempt<30; attempt++)); do
        worker=0
        for pid in $pids; do if kill -0 "$pid" 2>/dev/null; then worker=1; fi; done
        [[ $worker -eq 1 ]] || break
        sleep 1
      done
      [[ $worker -eq 0 ]] || failed=1
      systemctl is-active --quiet nginx || failed=1
    fi
    if [[ $failed -eq 1 ]]; then
      for path in "$NGINX_SITE" "$NGINX_LINK" "$HEADERS_SNIPPET" "$CACHE_MAP"; do
        if [[ -e $quarantine$path || -L $quarantine$path ]]; then mv -- "$quarantine$path" "$path" || true; fi
      done
      # A reload that does not actually take is a silent recovery failure: the
      # files are back on disk but nginx may still be running without them.
      local restored=0 drain pids2 p hung
      if nginx -t >>"$LOG_PATH" 2>&1; then
        restored=1
        if [[ $active -eq 1 ]]; then
          pids2=$(pgrep -f '^nginx: worker process' || true)
          systemctl reload nginx >>"$LOG_PATH" 2>&1 || restored=0
          if [[ $restored -eq 1 && -n $pids2 ]]; then
            for ((drain = 0; drain < 30; drain++)); do
              hung=0
              for p in $pids2; do kill -0 "$p" 2>/dev/null && hung=1; done
              [[ $hung -eq 1 ]] || break
              sleep 1
            done
            [[ $hung -eq 0 ]] || restored=0
          fi
          systemctl is-active --quiet nginx || restored=0
        fi
      fi
      if [[ $restored -eq 1 ]]; then
        rm -rf -- "$quarantine"
      else warn "Recovery incomplete; inspect $quarantine before retrying."; fi
      die 'nginx detach failed; application files were retained.'
    fi
    rm -rf -- "$quarantine" || die 'Could not remove nginx quarantine.'
  fi
  # Logging must not recreate an unlinked installation log.
  LOG_READY=0 LOG_PATH=/dev/null
  if have nginx; then
    local remaining
    remaining=$(nginx -T 2>>"$LOG_PATH") || die 'Cannot inspect remaining nginx configuration; application files retained.'
    for i in "${!PLAN_PATHS[@]}"; do
      if [[ ${PLAN_TYPES[i]} == tree ]] && grep -Fq -- "${PLAN_PATHS[i]}" <<<"$remaining"; then
        die "Application directory is still referenced by nginx: ${PLAN_PATHS[i]}. Files retained."
      fi
    done
  fi
  # Settings/journal are deliberately last so a failed tree removal is retryable.
  for i in "${!PLAN_PATHS[@]}"; do
    path=${PLAN_PATHS[i]} kind=${PLAN_TYPES[i]}
    case $path in "$CONF_DIR"/*) continue ;; esac
    [[ -e $path || -L $path ]] || continue
    recheck_removal_record "$i"
    case $kind in
      tree) rm -rf --one-file-system -- "$path" || die "Partial uninstall: could not remove $path" ;;
      empty) rmdir -- "$path" 2>/dev/null || { warn "Nonempty directory retained: $path"; failed=1; } ;;
      *) rm -f -- "$path" || die "Partial uninstall: could not remove $path" ;;
    esac
  done
  [[ $failed -eq 0 ]] || die 'Partial uninstall: inspect retained directories.'
  for i in "${!PLAN_PATHS[@]}"; do
    path=${PLAN_PATHS[i]}
    case $path in "$CONF_DIR"/*) [[ ! -e $path && ! -L $path ]] || { recheck_removal_record "$i"; rm -f -- "$path"; } ;; esac
  done
  rm -f -- "$OWN_FILE"
  rmdir -- "$CONF_DIR" 2>/dev/null || { [[ ! -d $CONF_DIR ]] || warn "Additional settings files retained in $CONF_DIR"; }
  LOG_READY=0 LOG_PATH=/dev/null
  ok 'Managed Hamgam application resources removed.'
  report_preserved_resources
}

# ----------------------------------------------------------- arguments ----
NON_INTERACTIVE=0
ASSUME_YES=0
UPDATE_ONLY=0
ROLLBACK_ONLY=0
OPT_DOMAIN=''
OPT_EMAIL=''
OPT_SOURCE=''
OPT_GIT_URL=''
OPT_GIT_REF='main'
OPT_WEBROOT=''
OPT_REPO_DIR=''
OPT_DIST=''
OPT_EXTRA_HOSTS=''
OPT_CF_CREDENTIALS=''
OPT_ENABLE_CSP=1
OPT_SKIP_TLS=0
OPT_KEEP_DEFAULT_SITE=0
OPT_SWAP=off
OPT_TLS_MODE=''
OPT_TLS_CERT=''
OPT_TLS_KEY=''
TLS_MODE_ARG=''

usage() {
  cat <<'USAGE'
Hamgam | server installer

  sudo bash deploy/install.sh [options]

Options:
  --domain <name>        primary domain, e.g. fit.example.com
  --email <address>      address for Let's Encrypt
  --extra-hosts <list>   extra domains, comma separated
  --source <git|local|prebuilt>
                           git: clone and build on the server (default)
                           local: build from this working copy
                           prebuilt: deploy an existing dist directory
  --git-url <url>        repository URL for the git source
  --git-ref <ref>        branch or tag (default main)
  --dist <path>          dist directory, for the prebuilt source
  --webroot <path>       where releases are kept (default /var/www/hamgam)
  --repo-dir <path>      clone directory (default /opt/hamgam)
  --cf-credentials <file>
                           Cloudflare credentials for a DNS-01 certificate.
                           Needed when the domain sits behind the Cloudflare
                           proxy. File format: dns_cloudflare_api_token = <token>
  --swap=<off|auto>      off (default): never create swap, even with --yes
                           auto: allow 2 GiB of runtime swap if a build needs it
                           Swap stays active after success or failure; the file
                           stays after reboot. No /etc/fstab changes are made.
  --keep-default-site    leave the default nginx site alone (default: ask)
  --no-csp               do not send a Content-Security-Policy header
  --tls-mode <auto|manual|off>
                           auto: Certbot (default); manual: existing PEM files
  --tls-cert <path>      full certificate chain (implies manual with --tls-key)
  --tls-key <path>       unencrypted private key; never copied or deleted
  --skip-tls             alias for --tls-mode off (HTTP testing only)
  --non-interactive      ask nothing, use only the given options
  --update               update an existing install (source and deploy only)
  --rollback             roll back to the previous release
  --uninstall            remove only owned Hamgam resources (confirmation required)
  --dry-run              preview --uninstall without changing resources
  --adopt-legacy         explicitly review/adopt proven legacy installation paths
  --yes                  accept confirmation prompts
  --help                 this help
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --domain|--email|--extra-hosts|--source|--git-url|--git-ref|--dist|--webroot|--repo-dir|--cf-credentials|--tls-mode|--tls-cert|--tls-key)
        [[ $# -ge 2 && -n $2 && $2 != --* ]] || die "$1 needs a value." ;;
    esac
    case $1 in
      --tls-mode) set_tls_mode "$2"; shift 2 ;;
      --tls-cert) OPT_TLS_CERT=$2; shift 2 ;;
      --tls-key) OPT_TLS_KEY=$2; shift 2 ;;
      --domain) OPT_DOMAIN=${2:-}; shift 2 ;;
      --email) OPT_EMAIL=${2:-}; shift 2 ;;
      --extra-hosts) OPT_EXTRA_HOSTS=${2:-}; shift 2 ;;
      --source) OPT_SOURCE=${2:-}; shift 2 ;;
      --git-url) OPT_GIT_URL=${2:-}; shift 2 ;;
      --git-ref) OPT_GIT_REF=${2:-}; shift 2 ;;
      --dist) OPT_DIST=${2:-}; shift 2 ;;
      --webroot) OPT_WEBROOT=${2:-}; shift 2 ;;
      --repo-dir) OPT_REPO_DIR=${2:-}; shift 2 ;;
      --cf-credentials) OPT_CF_CREDENTIALS=${2:-}; shift 2 ;;
      --swap=*) OPT_SWAP=${1#--swap=}; shift ;;
      --swap) [[ $# -ge 2 ]] || die '--swap needs off or auto.'; OPT_SWAP=$2; shift 2 ;;
      --no-csp) OPT_ENABLE_CSP=0; shift ;;
      --skip-tls) set_tls_mode off; OPT_SKIP_TLS=1; shift ;;
      --keep-default-site) OPT_KEEP_DEFAULT_SITE=1; shift ;;
      --non-interactive) NON_INTERACTIVE=1; shift ;;
      --update) UPDATE_ONLY=1; shift ;;
      --rollback) ROLLBACK_ONLY=1; shift ;;
      --uninstall) UNINSTALL_ONLY=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --adopt-legacy) ADOPT_LEGACY=1; shift ;;
      --yes | -y) ASSUME_YES=1; shift ;;
      --help | -h) usage; exit 0 ;;
      *) die "Unknown option: $1 (run with --help for usage)" ;;
    esac
  done
  [[ $((UPDATE_ONLY + ROLLBACK_ONLY + UNINSTALL_ONLY)) -le 1 ]] || die 'Choose only one of --update, --rollback or --uninstall.'
  [[ $DRY_RUN -eq 0 && $ADOPT_LEGACY -eq 0 || $UNINSTALL_ONLY -eq 1 ]] || die '--dry-run and --adopt-legacy require --uninstall.'
  if [[ $UNINSTALL_ONLY -eq 1 ]]; then
    [[ -z $OPT_DOMAIN$OPT_EMAIL$OPT_SOURCE$OPT_GIT_URL$OPT_WEBROOT$OPT_REPO_DIR$OPT_DIST$OPT_CF_CREDENTIALS$OPT_TLS_CERT$OPT_TLS_KEY$TLS_MODE_ARG && $OPT_SWAP == off ]] || die 'Install options cannot be combined with --uninstall.'
  fi
  case $OPT_SWAP in
    off | auto) ;;
    *) die 'Invalid --swap policy; use --swap=off or --swap=auto.' ;;
  esac
}

# Manual mode references external files; ownership never transfers to Hamgam.
set_tls_mode() {
  case $1 in auto|manual|off) ;; *) die 'TLS mode must be auto, manual or off.' ;; esac
  [[ -z $TLS_MODE_ARG || $TLS_MODE_ARG == "$1" ]] || die 'Conflicting TLS modes.'
  TLS_MODE_ARG=$1
  OPT_TLS_MODE=$1
}

resolve_tls_options() {
  if [[ -n $OPT_TLS_CERT || -n $OPT_TLS_KEY ]]; then
    [[ -n $OPT_TLS_CERT && -n $OPT_TLS_KEY ]] || die '--tls-cert and --tls-key must be supplied together.'
    [[ -z $TLS_MODE_ARG || $TLS_MODE_ARG == manual ]] || die 'Manual certificate paths conflict with the TLS mode.'
    OPT_TLS_MODE=manual
  fi
  OPT_TLS_MODE=${OPT_TLS_MODE:-${CFG_TLS_MODE:-auto}}
  case $OPT_TLS_MODE in
    manual)
      OPT_TLS_CERT=${OPT_TLS_CERT:-${CFG_TLS_CERT:-}}
      OPT_TLS_KEY=${OPT_TLS_KEY:-${CFG_TLS_KEY:-}}
      OPT_SKIP_TLS=0 ;;
    off) OPT_TLS_CERT='' OPT_TLS_KEY='' OPT_SKIP_TLS=1 ;;
    auto) OPT_TLS_CERT='' OPT_TLS_KEY='' OPT_SKIP_TLS=0 ;;
    *) die 'Invalid saved TLS mode.' ;;
  esac
  [[ $OPT_TLS_MODE != manual || -z $OPT_CF_CREDENTIALS ]] || die 'Manual TLS cannot be combined with Cloudflare issuance credentials.'
}

safe_tls_path() { [[ $1 =~ ^/[a-zA-Z0-9_./:@+\ -]+$ && $1 != *..* ]]; }

trusted_certificate_path() {
  local path=$1 private=${2:-0} resolved owner mode current
  safe_tls_path "$path" || return 1
  resolved=$(readlink -f -- "$path") || return 1
  [[ -f $resolved && -r $resolved ]] || return 1
  # Check the lexical ancestry too: a safe target behind a replaceable link is unsafe.
  for current in "$path" "$resolved"; do
    while :; do
      read -r owner mode < <(stat -Lc '%u %a' -- "$current") || return 1
      [[ $owner == 0 && $mode =~ ^[0-7]{3,4}$ ]] || return 1
      if (( (8#$mode & 0022) != 0 )); then
        # A root-owned sticky directory such as /tmp cannot replace root's entries.
        [[ -d $current ]] && (( (8#$mode & 01000) != 0 )) || return 1
      fi
      [[ $current == / ]] && break
      current=$(dirname -- "$current") || return 1
    done
  done
  if [[ $private -eq 1 ]]; then
    mode=$(stat -Lc '%a' -- "$resolved") || return 1
    (( (8#$mode & 0077) == 0 )) || return 1
  fi
}

validate_manual_tls() {
  local cert=${OPT_TLS_CERT:-} key=${OPT_TLS_KEY:-} path resolved root cert_pub key_pub hosts h chain line issuer='' subject=''
  have openssl || die 'OpenSSL is required to validate manual TLS.'
  for path in "$cert" "$key"; do
    safe_tls_path "$path" || die 'Certificate paths must be absolute and contain no configuration metacharacters.'
    [[ -f $path && -r $path ]] || die "Cannot read TLS file: $path"
    resolved=$(readlink -f -- "$path") || die 'Cannot resolve a TLS file.'
    for root in "${OPT_WEBROOT:-/var/www/hamgam}" "${OPT_REPO_DIR:-/opt/hamgam}" "$CONF_DIR"; do
      root=$(readlink -m -- "$root") || die 'Cannot resolve an application directory.'
      [[ $resolved != "$root" && $resolved != "$root/"* ]] || die 'Keep manual TLS files outside Hamgam application/configuration directories.'
    done
  done
  trusted_certificate_path "$cert" || die 'Unsafe certificate ownership or permissions; use root-owned files and protected parent directories.'
  trusted_certificate_path "$key" 1 || die 'Unsafe private-key permissions; require root ownership and mode 600 (or 400) with protected parents.'
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die 'The certificate is not valid PEM.'
  openssl pkey -in "$key" -passin pass: -noout >/dev/null 2>&1 || die 'The private key is invalid or encrypted; an unattended unencrypted PEM key is required.'
  cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256) || die 'Could not read certificate public key.'
  key_pub=$(openssl pkey -in "$key" -passin pass: -pubout -outform DER 2>/dev/null | openssl dgst -sha256) || die 'Could not read private-key public key.'
  [[ $cert_pub == "$key_pub" ]] || die 'The certificate and private key do not match.'
  chain=$(openssl crl2pkcs7 -nocrl -certfile "$cert" 2>/dev/null | openssl pkcs7 -print_certs -noout 2>/dev/null) || die 'Malformed certificate chain.'
  while IFS= read -r line; do
    case $line in
      subject=*)
        subject=${line#subject=}
        [[ -z $issuer || $issuer == "$subject" ]] || die 'The fullchain certificates are not in leaf-to-root order.' ;;
      issuer=*) issuer=${line#issuer=} ;;
    esac
  done <<<"$chain"
  hosts="${OPT_DOMAIN} ${OPT_EXTRA_HOSTS//,/ }"
  # Browsers ignore the legacy CN and require the name in a DNS SAN. OpenSSL
  # still falls back to CN, so the hostname check alone would accept a
  # certificate that every browser rejects.
  local san_names san_host covered
  san_names=$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | tr -d ' \n') || die 'Could not read the certificate subjectAltName.'
  [[ -n $san_names ]] || die 'The certificate has no subjectAltName; browsers reject CN-only certificates.'
  for h in $hosts; do
    covered=0
    for san_host in ${san_names//,/ }; do
      [[ $san_host == "DNS:$h" ]] && covered=1
      # A wildcard covers exactly one label.
      if [[ $san_host == 'DNS:*.'* ]]; then
        san_host=${san_host#DNS:*.}
        [[ $h == *".$san_host" && ${h%.*} != *.* ]] && covered=1
      fi
    done
    [[ $covered -eq 1 ]] || die "The certificate subjectAltName does not include $h. Browsers will reject it."
  done
  local ca_args=()
  [[ -z ${SSL_CERT_FILE:-} ]] || ca_args=(-CAfile "$SSL_CERT_FILE")
  for h in $hosts; do
    [[ $h =~ $VALID_DOMAIN_RE ]] || die "Invalid TLS host: $h"
    openssl verify "${ca_args[@]}" -purpose sslserver -verify_hostname "$h" -untrusted "$cert" "$cert" >/dev/null 2>&1 ||
      die "Certificate trust, validity dates, server-auth usage or domain coverage failed for $h. Use a trusted fullchain; verification is never disabled."
  done
  ok 'Manual TLS certificate, chain, domains and private key validated'
}

# ------------------------------------------------------------- helpers ----
have() { command -v "$1" >/dev/null 2>&1; }

# Run a command, recording its whole output in the log.
run_logged() {
  log "run: $*"
  if [[ $LOG_READY -eq 1 ]]; then
    if ! "$@" >>"$LOG_PATH" 2>&1; then
      log "FAILED: $*"
      return 1
    fi
  else
    if ! "$@" >/dev/null 2>&1; then
      log "FAILED: $*"
      return 1
    fi
  fi
  return 0
}

# Wait for the apt lock to clear. On a fresh server unattended-upgrades may
# be running, and installing packages without waiting fails.
wait_for_apt() {
  local waited=0 limit=300
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 ||
    fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    if [[ $waited -eq 0 ]]; then
      warn 'The package manager is busy (probably an automatic update). Waiting...'
    fi
    sleep 5
    waited=$((waited + 5))
    if [[ $waited -ge $limit ]]; then
      die 'The apt lock did not clear within 5 minutes. Check unattended-upgrades.'
    fi
  done
  if [[ $waited -gt 0 ]]; then ok 'The apt lock cleared.'; fi
  return 0
}

apt_install() {
  wait_for_apt
  run_logged env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

ask_value() {
  # ask_value <variable> <label> <default> <validation pattern> <error message>
  local __var=$1 label=$2 default=$3 pattern=$4 errmsg=$5 input=''
  while true; do
    if [[ -n $default ]]; then
      ui_out "${C_BOLD}  $label${C_RESET} ${C_DIM}[$default]${C_RESET}"
    else
      ui_out "${C_BOLD}  $label${C_RESET}"
    fi
    read -r -p "  › " input || die 'Could not read input.'
    input=${input:-$default}
    if [[ -z $input ]]; then
      bad 'This value is required.'
      continue
    fi
    if [[ -n $pattern && ! $input =~ $pattern ]]; then
      bad "$errmsg"
      continue
    fi
    printf -v "$__var" '%s' "$input"
    return 0
  done
}

ask_yes_no() {
  # ask_yes_no <label> <default y|n>
  local label=$1 default=${2:-n} input='' hint
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    [[ $default == y ]]
    return
  fi
  hint='y/N'
  [[ $default == y ]] && hint='Y/n'
  while true; do
    ui_out "${C_BOLD}  $label${C_RESET} ${C_DIM}($hint)${C_RESET}"
    read -r -p "  › " input || die 'Could not read input.'
    input=${input:-$default}
    case ${input,,} in
      y | yes) return 0 ;;
      n | no) return 1 ;;
      *) bad 'Please answer y or n.' ;;
    esac
  done
}

# ---------------------------------------------------------- validation ----
VALID_DOMAIN_RE='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
VALID_EMAIL_RE='^[^@[:space:]]+@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'

valid_path() { [[ $1 == /* && $1 != *..* && ${#1} -lt 200 ]]; }

# Critical guard: never let the path being pruned be a system or root path.
guard_webroot() {
  local p=${1:-}
  [[ -n $p ]] || die 'The web root is empty.'
  valid_path "$p" || die "Invalid web root: $p"
  case $p in
    / | /etc | /etc/* | /usr | /usr/* | /bin | /bin/* | /sbin | /sbin/* | \
      /lib | /lib/* | /lib64 | /lib64/* | /boot | /boot/* | /dev | /dev/* | \
      /proc | /proc/* | /sys | /sys/* | /root | /root/* | /var | /home | /opt | /srv)
      die "Unsafe web root for this operation: $p"
      ;;
  esac
  local depth
  depth=$(awk -F/ '{print NF-1}' <<<"$p")
  if [[ $depth -lt 2 ]]; then
    die "The web root needs at least two levels (like /var/www/hamgam): $p"
  fi
  if [[ -e $p && ! -d $p ]]; then
    die "The web root is not a directory: $p"
  fi
  return 0
}

acquire_lock() {
  local dir
  dir=$(dirname "$LOCK_FILE")
  [[ -d $dir ]] || dir=/tmp
  if ! exec 9>"$dir/hamgam-install.lock" 2>/dev/null; then
    if ! exec 9>/tmp/hamgam-install.lock 2>/dev/null; then
      warn 'Could not create the lock file; continuing without a lock.'
      return 0
    fi
  fi
  if ! flock -w 300 9; then
    die 'Another run of this installer is in progress. Try again in a few minutes.'
  fi
  return 0
}

# ------------------------------------------------------- prerequisites ----
need_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    plain ''
    plain "  ${C_YELLOW}This script needs root to install packages and configure nginx.${C_RESET}"
    plain "  ${C_DIM}Re-running under sudo now; it may ask for your password.${C_RESET}"
    plain ''
    if ! have sudo; then
      die 'sudo is not installed. Run the script as root.'
    fi
    exec sudo -E bash "$0" "$@"
  fi
}

# An nginx from snap or outside the apt package is not compatible with this
# installer, so it is detected before anything is changed.
detect_foreign_nginx() {
  have nginx || return 0
  local bin
  bin=$(readlink -f "$(command -v nginx)" 2>/dev/null || true)
  [[ -n $bin ]] || return 0
  case $bin in
    /snap/*)
      die "nginx is installed from snap ($bin). This installer only manages the apt package. Remove it with 'sudo snap remove nginx' and run again."
      ;;
    /usr/sbin/nginx | /usr/bin/nginx) ;;
    *)
      warn "nginx runs from an unusual path: $bin"
      if [[ $NON_INTERACTIVE -eq 0 ]]; then
        ask_yes_no 'Continue? Configuration may be written elsewhere.' n ||
          die 'Stopped at your request.'
      fi
      ;;
  esac
  return 0
}

check_ports_free() {
  have ss || return 0
  local busy='' port svc
  for port in 80 443; do
    if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      svc=$(ss -H -ltnp "sport = :$port" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1 || true)
      if [[ $svc == nginx ]]; then continue; fi
      busy+="${port} (${svc:-unknown}) "
    fi
  done
  if [[ -n $busy ]]; then
    bad "These ports are held by another service: $busy"
    note 'If Apache or another service owns these ports, stop it first:'
    note '  sudo systemctl stop apache2 && sudo systemctl disable apache2'
    die 'The required ports are not free.'
  fi
  ok 'Ports 80 and 443 are free'
  return 0
}

preflight() {
  step 'Checking the system and prerequisites'

  if [[ ! -r /etc/os-release ]]; then
    die '/etc/os-release not found; this OS is not supported.'
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  local id=${ID:-unknown} ver=${VERSION_ID:-0}
  case $id in
    ubuntu | debian) ;;
    *) die "This installer targets Ubuntu and Debian. Current system: $id" ;;
  esac
  ok "System: ${PRETTY_NAME:-$id $ver}"
  log "os: $PRETTY_NAME arch: $(uname -m)"

  local arch
  arch=$(uname -m)
  if [[ $arch != x86_64 && $arch != aarch64 && $arch != arm64 ]]; then
    warn "Architecture $arch is untested; continuing anyway."
  fi

  if ! [[ $ver =~ ^[0-9]+ ]]; then
    warn "Could not read the OS version ($ver); continuing anyway."
  elif [[ $id == ubuntu && ${ver%%.*} -lt 22 ]]; then
    warn "Ubuntu $ver is old; 22.04 or newer is recommended."
  fi

  detect_foreign_nginx
  check_ports_free

  # Disk space: source, node_modules and dist need about 1 GB.
  local avail_kb
  avail_kb=$(df -Pk / | awk 'NR==2 {print $4}')
  if [[ -n $avail_kb && $avail_kb -lt 1500000 ]]; then
    die "Not enough disk space: $((avail_kb / 1024)) MB free, at least 1500 MB is required."
  fi
  ok "Disk space: $((avail_kb / 1024 / 1024)) GB free"

  # Network and DNS
  if ! getent hosts deb.debian.org >/dev/null 2>&1 && ! getent hosts archive.ubuntu.com >/dev/null 2>&1; then
    die 'Could not reach the package repositories. Check the network and DNS on this server.'
  fi
  ok 'Package repositories are reachable'

  # Base tools the script itself needs.
  local missing=() tool
  for tool in curl ca-certificates; do
    dpkg -s "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    note "Installing base tools: ${missing[*]}"
    if ! run_logged apt-get update -qq; then die 'apt-get update failed.'; fi
    apt_install "${missing[@]}" || die 'Installing base tools failed.'
  fi
  ok 'Base tools are present'

  # Source-build admission is checked later, after the source mode is known.
  # Prebuilt installs and rollbacks must not prepare or mutate swap.
  return 0
}

# ---------------------------------------------------- build memory policy ----
BUILD_MEM_MB=0
BUILD_AVAIL_MB=0
BUILD_SWAP_FREE_MB=0
BUILD_MEMORY_KNOWN=0
BUILD_MEMORY_RESTRICTED=1
BUILD_CGROUP_DIRS=()

read_host_memory() {
  local file=${1:-/proc/meminfo}
  read -r BUILD_MEM_MB BUILD_AVAIL_MB BUILD_SWAP_FREE_MB < <(
    awk '/^MemTotal:/ {m=int($2/1024)} /^MemAvailable:/ {a=int($2/1024)}
      /^SwapFree:/ {s=int($2/1024)} END {print m+0, a+0, s+0}' "$file"
  )
}

# Inspect every visible ancestor, not just the leaf. Unknown accounting must
# never turn host RAM/swap into a false promise of container build capacity.
read_cgroup_limits() {
  local membership=$1 mount=$2 mount_root=$3 path dir value current mb free_mb
  BUILD_MEMORY_KNOWN=0 BUILD_MEMORY_RESTRICTED=1 BUILD_CGROUP_DIRS=()
  [[ $mount_root == / && -r $mount/cgroup.controllers ]] || return 0
  # Only the full hierarchy root lacks these limit files. A namespaced root
  # exposing max still may have finite, hidden ancestors: do not trust it.
  [[ ! -e $mount/memory.max && ! -e $mount/memory.swap.max ]] || return 0
  path=$(awk -F: '$1 == "0" && $2 == "" {print $3}' "$membership")
  [[ $path == /* && $path != *..* && $path != *$'\n'* ]] || return 0
  # Hybrid/v1 accounting is deliberately unsupported.
  if grep -qE '^[1-9][0-9]*:.*memory' "$membership"; then return 0; fi
  dir="${mount%/}${path%/}"
  BUILD_MEMORY_RESTRICTED=0
  while :; do
    BUILD_CGROUP_DIRS+=("$dir")
    local resource
    for resource in memory memory.swap; do
      # The full hierarchy root cannot itself be resource-limited.
      if [[ $dir == "${mount%/}" && ! -e $dir/$resource.max ]]; then continue; fi
      [[ -r $dir/$resource.max && -r $dir/$resource.current ]] || return 0
      value=$(<"$dir/$resource.max")
      current=$(<"$dir/$resource.current")
      [[ $current =~ ^[0-9]{1,18}$ ]] || return 0
      if [[ $value == max ]]; then continue; fi
      [[ $value =~ ^[0-9]{1,18}$ ]] || return 0
      BUILD_MEMORY_RESTRICTED=1
      mb=$((value / 1048576))
      free_mb=$(((value > current ? value - current : 0) / 1048576))
      if [[ $resource == memory ]]; then
        if [[ $mb -lt $BUILD_MEM_MB ]]; then BUILD_MEM_MB=$mb; fi
        if [[ $free_mb -lt $BUILD_AVAIL_MB ]]; then BUILD_AVAIL_MB=$free_mb; fi
      elif [[ $free_mb -lt $BUILD_SWAP_FREE_MB ]]; then
        BUILD_SWAP_FREE_MB=$free_mb
      fi
    done
    [[ $dir == "${mount%/}" ]] && break
    dir=${dir%/*}
    [[ $dir == "$mount" || $dir == "$mount/"* ]] || return 0
  done
  BUILD_MEMORY_KNOWN=1
}

in_build_container() {
  [[ -e /.dockerenv || -e /run/.containerenv || -n ${container:-} ]] ||
    { have systemd-detect-virt && systemd-detect-virt --container --quiet; }
}

read_build_memory() {
  read_host_memory /proc/meminfo
  BUILD_MEMORY_KNOWN=0 BUILD_MEMORY_RESTRICTED=1 BUILD_CGROUP_DIRS=()
  # Container namespaces may hide ancestors even when FSROOT reads '/'.
  # Prebuilt is the supported fallback rather than guessing host allowances.
  in_build_container && return 0
  [[ $(readlink /proc/self/ns/cgroup) == "$(readlink /proc/1/ns/cgroup)" ]] || return 0
  local mount='' root=''
  read -r mount root < <(findmnt -rn -t cgroup2 -o TARGET,FSROOT 2>/dev/null) || true
  read_cgroup_limits /proc/self/cgroup "$mount" "$root"
}

memory_snapshot() {
  local dir
  log "memory: effective RAM=${BUILD_MEM_MB}MiB available=${BUILD_AVAIL_MB}MiB usable swap free=${BUILD_SWAP_FREE_MB}MiB accounting known=$BUILD_MEMORY_KNOWN restricted=$BUILD_MEMORY_RESTRICTED"
  if [[ $LOG_READY -eq 1 ]]; then
    grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo >>"$LOG_PATH" || true
    for dir in "${BUILD_CGROUP_DIRS[@]}"; do
      log "cgroup: $dir"
      local resource
      for resource in memory.max memory.current memory.swap.max memory.swap.current; do
        if [[ -r $dir/$resource ]]; then log "$resource=$(<"$dir/$resource")"; fi
      done
      cat "$dir/memory.events" >>"$LOG_PATH" 2>/dev/null || true
    done
  fi
}

# Return 0 for active, 1 for inactive, 2 when the state cannot be established.
swap_file_active() {
  [[ -r /proc/swaps ]] || return 2
  awk -v file="$1" 'NR>1 && $1==file {found=1} END {exit !found}' /proc/swaps
}

trusted_swap_parent() {
  local path=$1 owner mode
  while :; do
    [[ -d $path && ! -L $path ]] || return 1
    owner=$(stat -c '%u' "$path") || return 1
    mode=$(stat -c '%a' "$path") || return 1
    [[ $owner == 0 && $mode =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$mode & 0022) == 0 )) || return 1
    [[ $path == / ]] && break
    path=$(dirname "$path")
  done
}

# An exclusive directory and a restrictive umask precede allocation. Retain
# activated swap even on failure: automatic swapoff can itself trigger OOM.
create_build_swap() (
  local dir=${1:-/var/lib/hamgam-build-swap} file parent fs avail_kb
  local directory_id='' file_id='' retained=0 state=2
  file="$dir/swapfile"
  parent=$(dirname "$dir")
  [[ ! -e $dir && ! -L $dir ]] || die "Swap path already exists: $dir. Inspect it manually; it will not be reused or overwritten."
  trusted_swap_parent "$parent" || die "Unsafe parent directory for swap: $parent"
  umask 077
  mkdir -m 700 -- "$dir" || die "Could not exclusively create $dir."
  # The caller runs this through `|| { ... }`, which suspends errexit for the
  # whole call: every step from here on has to check itself, or a failure would
  # carry on and the cleanup would be left without an identity to compare.
  directory_id=$(stat -c '%d:%i' "$dir") || die 'Could not read the swap directory identity.'
  [[ -n $directory_id ]] || die 'Could not read the swap directory identity.'

  # shellcheck disable=SC2317  # invoked by the subshell's EXIT trap
  cleanup_new_swap() {
    [[ $retained -eq 0 && ! -L $dir && $(stat -c '%d:%i' "$dir" 2>/dev/null) == "$directory_id" ]] || return 0
    if [[ -e $file || -L $file ]]; then
      [[ -n $file_id && ! -L $file && $(stat -c '%d:%i' "$file" 2>/dev/null) == "$file_id" ]] || return 0
      state=0
      swap_file_active "$file" || state=$?
      if [[ $state -ne 1 ]]; then
        warn "Swap activation is active or uncertain; retaining $file."
        return 0
      fi
      rm -f -- "$file" || return 0
    fi
    rmdir -- "$dir" 2>/dev/null || true
  }
  trap cleanup_new_swap EXIT

  fs=$(findmnt -rn -T "$dir" -o FSTYPE) || die 'Could not identify the swap filesystem.'
  case $fs in ext4 | xfs) ;; *) die "Automatic swap requires ext4 or XFS, not $fs. Use --source prebuilt." ;; esac
  avail_kb=$(df -Pk "$dir" | awk 'NR==2 {print $4}')
  [[ $avail_kb =~ ^[0-9]+$ && $avail_kb -ge 4194304 ]] ||
    die 'Swap needs 2 GiB for allocation plus 2 GiB of free disk space remaining.'
  note "Creating 2 GiB of runtime swap at $file..."
  local status=0
  dd if=/dev/zero of="$file" bs=1M count=2048 conv=excl,fsync oflag=nofollow >>"$LOG_PATH" 2>&1 || status=$?
  if [[ -f $file && ! -L $file ]]; then file_id=$(stat -c '%d:%i' "$file"); fi
  [[ $status -eq 0 ]] || die 'Swap allocation failed; inactive partial files will be removed.'
  [[ -f $file && ! -L $file && $(stat -c '%u:%a:%h' "$file") == '0:600:1' ]] ||
    die 'The new swapfile failed its ownership, mode or hard-link check.'
  run_logged mkswap "$file" || die 'mkswap failed. Use a prebuilt bundle instead.'
  run_logged swapon "$file" || die 'swapon failed (host/kernel restrictions or unsupported file). Use --source prebuilt.'
  if ! swap_file_active "$file"; then
    retained=1
    die "Could not confirm activation; retaining $file for manual inspection."
  fi
  retained=1
  ok "Runtime swap active: $file (2 GiB)"
  warn 'Swap remains active after success or failure. The file remains after reboot.'
  note 'No /etc/fstab changes were made. Never remove the file while it is active.'
)

prepare_build_memory() {
  read_build_memory
  memory_snapshot
  [[ $BUILD_MEMORY_KNOWN -eq 1 && $BUILD_MEM_MB -gt 0 ]] ||
    die 'Cannot safely determine build memory/cgroup limits. Use --source prebuilt with an APP_BASE=/ bundle.'
  if [[ $BUILD_MEM_MB -ge 1536 || $BUILD_SWAP_FREE_MB -ge 1024 ]]; then return 0; fi
  warn "Source build has only ${BUILD_MEM_MB} MiB RAM and ${BUILD_SWAP_FREE_MB} MiB of usable free swap."
  if [[ $OPT_SWAP != auto ]]; then
    die 'Not starting a low-memory build. Re-run with --swap=auto to allow runtime swap, or use --source prebuilt.'
  fi
  if [[ $BUILD_MEMORY_RESTRICTED -eq 1 ]] || in_build_container; then
    die 'Automatic host swap is disabled in containers or limited cgroups. Provide allowed swap externally or use --source prebuilt.'
  fi
  # The helper runs in a subshell, so its own die() can only end that subshell.
  # The status is handed to the frame that can stop the install. The subshell
  # can fail before SWAP_DONE is set: default it here.
  local status=0
  create_build_swap /var/lib/hamgam-build-swap || {
    status=$?
    stop_install "$status"
  }
  read_build_memory
  memory_snapshot
  [[ $BUILD_SWAP_FREE_MB -ge 1024 ]] || die 'Usable swap is still below 1024 MiB; refusing the build. Use --source prebuilt.'
}

# ---------------------------------------------------------- settings -------
load_saved_conf() {
  [[ -r $CONF_FILE ]] || return 1
  # Clear previous values first, so a key missing from the config file cannot
  # silently leave a stale value behind instead of failing loudly.
  # shellcheck disable=SC2034
  CFG_DOMAIN='' CFG_EMAIL='' CFG_SOURCE='' CFG_GIT_URL='' CFG_GIT_REF=''
  CFG_WEBROOT='' CFG_REPO_DIR='' CFG_EXTRA_HOSTS='' CFG_ENABLE_CSP='' CFG_DIST=''
  CFG_TLS_MODE='' CFG_TLS_CERT='' CFG_TLS_KEY=''
  # shellcheck disable=SC1090
  . "$CONF_FILE" || return 1
  return 0
}

validate_extra_hosts() {
  [[ -n $OPT_EXTRA_HOSTS ]] || return 0
  local h
  IFS=',' read -ra hosts <<<"$OPT_EXTRA_HOSTS"
  for h in "${hosts[@]}"; do
    h=$(printf '%s' "$h" | xargs)
    if [[ -n $h && ! $h =~ $VALID_DOMAIN_RE ]]; then
      die "Invalid extra domain: $h"
    fi
  done
  return 0
}

collect_config() {
  step 'Collecting settings'

  if [[ $UPDATE_ONLY -eq 1 || $ROLLBACK_ONLY -eq 1 ]]; then
    load_saved_conf || die "No previous install found ($CONF_FILE). Run again without --update/--rollback."
    ok "Read the previous install's settings: $CFG_DOMAIN"
    # Restore every saved value, not just the paths. Otherwise an update leaves
    # OPT_SOURCE empty and the build step never runs at all.
    # An explicit command-line value wins over the saved one.
    OPT_DOMAIN=${OPT_DOMAIN:-$CFG_DOMAIN}
    OPT_EMAIL=${OPT_EMAIL:-$CFG_EMAIL}
    OPT_SOURCE=${OPT_SOURCE:-$CFG_SOURCE}
    OPT_GIT_URL=${OPT_GIT_URL:-$CFG_GIT_URL}
    OPT_GIT_REF=${OPT_GIT_REF:-$CFG_GIT_REF}
    OPT_WEBROOT=${OPT_WEBROOT:-$CFG_WEBROOT}
    OPT_REPO_DIR=${OPT_REPO_DIR:-$CFG_REPO_DIR}
    OPT_DIST=${OPT_DIST:-${CFG_DIST:-}}
    OPT_EXTRA_HOSTS=${OPT_EXTRA_HOSTS:-${CFG_EXTRA_HOSTS:-}}
    # If --no-csp was not given and CSP was already off, it stays off.
    if [[ $OPT_ENABLE_CSP -eq 1 && ${CFG_ENABLE_CSP:-1} -eq 0 ]]; then
      OPT_ENABLE_CSP=0
    fi
    if [[ -z ${OPT_DOMAIN:-} ]]; then
      die "The saved settings are incomplete ($CONF_FILE). Run a fresh install."
    fi
    resolve_tls_options
    guard_webroot "$OPT_WEBROOT"
    # A settings file from an older version may name a source mode it cannot
    # repeat: refuse here with the missing value instead of failing later
    # inside readlink with no useful message.
    if [[ $OPT_SOURCE == prebuilt && -z ${OPT_DIST:-} ]]; then
      die 'This install used a prebuilt directory, but its path was not saved. Re-run with --dist <path>.'
    fi
    if [[ $ROLLBACK_ONLY -eq 0 && $OPT_TLS_MODE == manual ]]; then validate_manual_tls; fi
    return 0
  fi

  # Command-line values take priority over saved settings.
  if load_saved_conf; then
    OPT_DOMAIN=${OPT_DOMAIN:-$CFG_DOMAIN}
    OPT_EMAIL=${OPT_EMAIL:-$CFG_EMAIL}
    OPT_SOURCE=${OPT_SOURCE:-$CFG_SOURCE}
    OPT_GIT_URL=${OPT_GIT_URL:-$CFG_GIT_URL}
    OPT_GIT_REF=${OPT_GIT_REF:-$CFG_GIT_REF}
    OPT_WEBROOT=${OPT_WEBROOT:-$CFG_WEBROOT}
    OPT_REPO_DIR=${OPT_REPO_DIR:-$CFG_REPO_DIR}
    OPT_EXTRA_HOSTS=${OPT_EXTRA_HOSTS:-$CFG_EXTRA_HOSTS}
    warn 'A previous install was found on this server; its values are suggested.'
  fi

  OPT_SOURCE=${OPT_SOURCE:-git}
  OPT_GIT_URL=${OPT_GIT_URL:-$REPO_URL_DEFAULT}
  OPT_WEBROOT=${OPT_WEBROOT:-/var/www/hamgam}
  OPT_REPO_DIR=${OPT_REPO_DIR:-/opt/hamgam}

  resolve_tls_options
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    [[ -n $OPT_DOMAIN ]] || die '--domain is required in non-interactive mode.'
    if [[ $OPT_TLS_MODE == auto && -z $OPT_EMAIL ]]; then die '--email is required for automatic TLS.'; fi
  else
    plain ''
    plain "  ${C_DIM}A few values are needed. Press Enter to accept any default.${C_RESET}"
    ask_value OPT_DOMAIN 'Site domain (without https)' "$OPT_DOMAIN" "$VALID_DOMAIN_RE" \
      'Not a valid domain. Example: fit.example.com'
    ask_value OPT_TLS_MODE 'Certificate mode (auto/manual/off)' "$OPT_TLS_MODE" '^(auto|manual|off)$' 'Enter auto, manual or off.'
    if [[ $OPT_TLS_MODE == manual ]]; then
      ask_value OPT_TLS_CERT 'Full certificate chain PEM path' "$OPT_TLS_CERT" '' ''
      ask_value OPT_TLS_KEY 'Unencrypted private key PEM path' "$OPT_TLS_KEY" '' ''
    elif [[ $OPT_TLS_MODE == auto ]]; then
      ask_value OPT_EMAIL 'Email for the SSL certificate' "$OPT_EMAIL" "$VALID_EMAIL_RE" 'Not a valid email.'
    fi
    # Interactive selection wins over previously saved values.
    if [[ $OPT_TLS_MODE != manual ]]; then OPT_TLS_CERT='' OPT_TLS_KEY=''; fi
    resolve_tls_options
    ask_value OPT_WEBROOT 'Directory that holds the releases' "$OPT_WEBROOT" '' ''
    ask_value OPT_SOURCE 'Source mode (git/local/prebuilt)' "$OPT_SOURCE" '^(git|local|prebuilt)$' \
      'Enter one of git, local or prebuilt.'
    if [[ $OPT_SOURCE == git ]]; then
      ask_value OPT_GIT_URL 'Git repository URL' "$OPT_GIT_URL" '^(https?://|git@|/).+' \
        'Not a valid repository URL.'
      ask_value OPT_GIT_REF 'Branch or tag' "$OPT_GIT_REF" '' ''
      ask_value OPT_REPO_DIR 'Directory that holds the clone on this server' "$OPT_REPO_DIR" '' ''
    elif [[ $OPT_SOURCE == prebuilt ]]; then
      ask_value OPT_DIST 'Path to the ready dist directory' "${OPT_DIST:-}" '' ''
    fi
  fi

  # Final validation, regardless of where each value came from.
  [[ $OPT_DOMAIN =~ $VALID_DOMAIN_RE ]] || die "Invalid domain: $OPT_DOMAIN"
  if [[ $OPT_TLS_MODE == auto ]]; then [[ $OPT_EMAIL =~ $VALID_EMAIL_RE ]] || die "Invalid email: $OPT_EMAIL"; fi
  guard_webroot "$OPT_WEBROOT"
  valid_path "$OPT_REPO_DIR" || die "Invalid clone path: $OPT_REPO_DIR"
  validate_extra_hosts
  case $OPT_SOURCE in
    git)
      [[ -n $OPT_GIT_URL ]] || die 'The git source needs a repository URL.'
      [[ -n $OPT_GIT_REF ]] || die 'The git source needs a branch.'
      ;;
    local)
      [[ -f ${PWD}/package.json ]] ||
        die "No package.json in the current directory. Run the script from the repository root."
      ;;
    prebuilt)
      [[ -n ${OPT_DIST:-} && -d ${OPT_DIST:-} ]] || die "dist directory not found: ${OPT_DIST:-empty}"
      ;;
    *) die "Invalid source mode: $OPT_SOURCE" ;;
  esac

  if [[ -n $OPT_CF_CREDENTIALS && ! -r $OPT_CF_CREDENTIALS ]]; then
    die "Could not read the Cloudflare credentials: $OPT_CF_CREDENTIALS"
  fi

  if [[ $OPT_TLS_MODE == manual ]]; then validate_manual_tls; fi

  # Summary and confirmation
  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    ui_out ''
    hr
    plain "  ${C_BOLD}Install summary${C_RESET}"
    plain "    Site domain      ${C_BOLD}$OPT_DOMAIN${C_RESET}"
    plain "    TLS mode         $OPT_TLS_MODE"
    if [[ $OPT_TLS_MODE == manual ]]; then
      plain "    Certificate      $OPT_TLS_CERT"
      plain "    Private key      $OPT_TLS_KEY"
    else
      plain "    Certificate mail $OPT_EMAIL"
    fi
    plain "    Source mode      $OPT_SOURCE"
    if [[ $OPT_SOURCE == git ]]; then
      plain "    Repository       $OPT_GIT_URL ($OPT_GIT_REF)"
      plain "    Clone directory  $OPT_REPO_DIR"
    fi
    plain "    Web root         $OPT_WEBROOT"
    plain "    Releases         $OPT_WEBROOT/releases"
    if [[ $OPT_SKIP_TLS -eq 1 ]]; then plain "    SSL certificate  not installed ${C_DIM}(--skip-tls)${C_RESET}"; fi
    if [[ $OPT_ENABLE_CSP -eq 0 ]]; then plain "    CSP header       disabled ${C_DIM}(--no-csp)${C_RESET}"; fi
    hr
    ask_yes_no 'Continue with these values?' y || die 'Stopped at your request.'
  fi
  return 0
}

save_config() {
  mkdir -p "$CONF_DIR"
  chmod 700 "$CONF_DIR"
  local tmp name value
  tmp=$(mktemp "$CONF_DIR/.install.conf.XXXXXX") || die 'Cannot stage install settings.'
  chmod 600 "$tmp"
  printf '# Hamgam install settings; written by deploy/install.sh.\n' >"$tmp"
  for name in DOMAIN EMAIL SOURCE GIT_URL GIT_REF WEBROOT REPO_DIR DIST EXTRA_HOSTS ENABLE_CSP TLS_MODE TLS_CERT TLS_KEY; do
    value="OPT_$name"
    printf 'CFG_%s=%q\n' "$name" "${!value}" >>"$tmp"
  done
  mv -f -- "$tmp" "$CONF_FILE"
  record_if_installing file "$CONF_FILE"
  record_nginx_resources
  local site_log
  for site_log in /var/log/nginx/hamgam.access.log /var/log/nginx/hamgam.error.log; do
    if [[ -f $site_log ]]; then record_if_installing log "$site_log"; fi
  done
  chmod 600 "$CONF_FILE"
  ok "Settings saved: $CONF_FILE"
  return 0
}

# ----------------------------------------------------- installing deps -----
install_packages() {
  step 'Installing required packages'

  wait_for_apt
  note 'Refreshing the package index...'
  run_logged apt-get update -qq || die 'apt-get update failed. Check the repository sources.'
  ok 'Package index refreshed'

  local packages=(nginx curl git rsync ca-certificates openssl gnupg dnsutils)
  local missing=() p
  for p in "${packages[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    note "Installing: ${missing[*]}"
    apt_install "${missing[@]}" || die 'Installing base packages failed.'
  fi
  ok 'nginx and the base tools are installed'

  # Check once more after installing, in case nginx came from snap.
  detect_foreign_nginx

  if [[ ${OPT_TLS_MODE:-auto} == auto ]]; then
    if ! dpkg -s python3-certbot-nginx >/dev/null 2>&1; then
      note 'Installing certbot for a free SSL certificate...'
      if ! apt_install python3-certbot-nginx; then
        warn 'Installing certbot failed; carrying on so the reason is reported at the end.'
        OPT_SKIP_TLS=1
      fi
    fi
    if [[ $OPT_SKIP_TLS -eq 0 ]]; then ok 'certbot is ready'; fi

    if [[ -n $OPT_CF_CREDENTIALS ]] && ! dpkg -s python3-certbot-dns-cloudflare >/dev/null 2>&1; then
      note 'Installing the Cloudflare DNS plugin for certbot...'
      apt_install python3-certbot-dns-cloudflare ||
        warn 'Installing the Cloudflare plugin failed.'
    fi
  fi

  # Node is only needed when building on the server.
  if [[ $OPT_SOURCE == git || $OPT_SOURCE == local ]]; then
    local have_node=0 major=''
    if have node; then
      major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
      if [[ $major =~ ^[0-9]+$ && $major -ge 20 ]]; then
        have_node=1
        ok "Node.js already present: $(node -v)"
      else
        warn "Node.js is old ($(node -v)); installing version $NODE_MAJOR."
      fi
    fi
    if [[ $have_node -eq 0 ]]; then
      note "Installing Node.js $NODE_MAJOR LTS from NodeSource..."
      install_node
    fi
    ok "npm: $(npm -v)"
  fi
  return 0
}

install_node() {
  local keyring=/usr/share/keyrings/nodesource.gpg
  wait_for_apt
  mkdir -p /usr/share/keyrings
  # The NodeSource signing key. If it cannot be fetched, the install stops:
  # a repository without its key cannot be trusted.
  if ! curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor -o "$keyring" 2>>"$LOG_PATH"; then
    die 'Could not fetch the NodeSource signing key. Check access to deb.nodesource.com.'
  fi
  chmod 644 "$keyring"
  echo "deb [signed-by=$keyring] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  run_logged apt-get update -qq || die 'apt-get update failed after adding the NodeSource repository.'
  apt_install nodejs || die 'Installing Node.js failed.'
  have node || die 'Node.js is still not on PATH after installing.'
  return 0
}

# -------------------------------------------- build user (non-root) --
# Running npm ci and the build as root would give dependency lifecycle
# scripts root as well. That is not acceptable.
BUILD_USER=''
BUILD_UID=0
BUILD_GID=0
BUILD_HOME=''

pick_build_user() {
  local candidate=''
  if [[ -n ${SUDO_USER:-} && ${SUDO_USER} != root ]] && id "$SUDO_USER" >/dev/null 2>&1; then
    candidate=$SUDO_USER
  elif [[ $OPT_SOURCE == local && -f ${PWD}/package.json ]]; then
    candidate=$(stat -c '%U' "${PWD}/package.json" 2>/dev/null || true)
  elif id www-data >/dev/null 2>&1; then
    candidate=www-data
  fi

  if [[ -z $candidate || $candidate == root ]]; then
    warn 'No non-root user available to build with; building as root.'
    return 0
  fi
  BUILD_USER=$candidate
  BUILD_UID=$(id -u "$BUILD_USER")
  BUILD_GID=$(id -g "$BUILD_USER")
  ok "Building as ${BUILD_USER} (not root)"
  return 0
}

# Run a command as the build user, inside the given directory.
# Note: setpriv execs a real program, so run_logged cannot be called here
# (a shell function does not exist in the new process); the output is
# redirected to the log directly.
run_as_build_user() {
  local dir=$1
  shift
  local out=/dev/null status=0
  if [[ $LOG_READY -eq 1 ]]; then out=$LOG_PATH; fi
  log "run(as ${BUILD_USER:-root}): $*"

  if [[ $BUILD_UID -eq 0 ]] || ! have setpriv; then
    if [[ $BUILD_UID -ne 0 ]]; then
      warn 'setpriv is not available; building as root.'
    fi
    (cd "$dir" && "$@") >>"$out" 2>&1 || status=$?
  else
    (
      cd "$dir" || exit 1
      setpriv --reuid="$BUILD_UID" --regid="$BUILD_GID" --clear-groups \
        env HOME="$BUILD_HOME" npm_config_cache="$BUILD_HOME/.npm" "$@"
    ) >>"$out" 2>&1 || status=$?
  fi
  if [[ $status -ne 0 ]]; then log "FAILED (exit $status): $*"; fi
  return "$status"
}

# Keep diagnostic failures from masking the observed npm status. npm may itself
# normalise a child's status; only report the status that we actually observed.
run_build_phase() {
  local dir=$1 label=$2 started status=0
  shift 2
  started=$(date +%s)
  log "$label started; inherited NODE_OPTIONS=${NODE_OPTIONS:-unset}; command: $*"
  read_build_memory
  memory_snapshot
  run_as_build_user "$dir" "$@" || status=$?
  log "$label finished after $(($(date +%s) - started))s (exit $status)"
  if [[ $status -ne 0 ]]; then
    read_build_memory || true
    memory_snapshot || true
    # Bound diagnostics to this phase. Failure to read the kernel log is benign.
    if [[ $LOG_READY -eq 1 ]] && have journalctl; then
      journalctl -k --since "@$started" --no-pager -n 100 >>"$LOG_PATH" 2>&1 || true
    fi
    if [[ $status -eq 137 ]]; then
      warn 'Exit 137 is compatible with SIGKILL, not proof of OOM. Check kernel/cgroup evidence in the log.'
    fi
    note 'For a small VPS, allow runtime swap with --swap=auto or deploy an APP_BASE=/ prebuilt bundle.'
    die "$label failed (exit $status). No new release was deployed. See the full log." "$status"
  fi
  return 0
}

# ----------------------------------------------------- source & build ----------
BUILD_DIR=''
BUILD_ID='manual'

fetch_and_build() {
  step 'Preparing the source and building'

  case $OPT_SOURCE in
    git) fetch_git ;;
    local) fetch_local ;;
    prebuilt) use_prebuilt ;;
  esac

  [[ -n $BUILD_DIR && -d $BUILD_DIR ]] || die 'Build output directory not found.'
  validate_build "$BUILD_DIR"
  ok 'The final output is ready'
  return 0
}

fetch_git() {
  local dir=$OPT_REPO_DIR
  if [[ -d $dir/.git ]]; then
    note "Updating the existing clone in $dir"
    run_logged git -C "$dir" fetch --depth 1 origin "$OPT_GIT_REF" ||
      die "Could not fetch branch $OPT_GIT_REF."
    run_logged git -C "$dir" checkout -f FETCH_HEAD || die 'Could not move to the fetched revision.'
    git -C "$dir" reset --hard FETCH_HEAD >/dev/null 2>&1 || true
  else
    note "Cloning into $dir"
    [[ ! -e $dir && ! -L $dir ]] || die 'Clone destination already exists and is not a repository; refusing to overwrite it.'
    mkdir -p "$(dirname "$dir")"
    run_logged git clone --depth 1 --branch "$OPT_GIT_REF" "$OPT_GIT_URL" "$dir" ||
      die "Clone failed. Check access to $OPT_GIT_URL."
    record_if_installing tree "$dir"
  fi
  BUILD_ID=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || printf 'nogit')
  ok "Source ready: $BUILD_ID"
  build_project "$dir"
}

fetch_local() {
  local dir
  dir=$(readlink -f "$PWD")
  BUILD_ID=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || printf 'nogit')
  ok "Using the local working copy: $dir"
  build_project "$dir"
}

build_project() {
  local dir=$1
  [[ -f $dir/package.json ]] || die "No package.json in $dir."
  if [[ ! -f $dir/package-lock.json ]]; then
    warn 'No package-lock.json; falling back to npm install.'
  fi

  # Stop here, in the frame that can: build_project's caller only forwards a
  # status, and forwarding is what used to hide the cause and skip the rollback.
  local mem_status=0
  prepare_build_memory || {
    mem_status=$?
    stop_install "$mem_status"
  }
  pick_build_user

  # Hand the cloned repository to the build user so npm can write to it. For a
  # local working copy, ownership is left alone.
  if [[ $OPT_SOURCE == git && $BUILD_UID -ne 0 ]]; then
    chown -R "$BUILD_UID:$BUILD_GID" "$dir"
  fi

  BUILD_HOME="$dir/.build-home"
  mkdir -p "$BUILD_HOME"
  if [[ $BUILD_UID -ne 0 ]]; then chown "$BUILD_UID:$BUILD_GID" "$BUILD_HOME"; fi
  chmod 700 "$BUILD_HOME"

  note 'Installing dependencies (this can take a few minutes)...'
  local extra_env=()
  if [[ $BUILD_MEM_MB -lt 1536 ]]; then
    # The cap bounds old-space only. Swap also backs native/child allocations.
    extra_env=(env NODE_OPTIONS=--max-old-space-size=512)
    note 'Low-memory build: Node old-space capped at 512 MiB (not total process memory).'
  fi

  if [[ -f $dir/package-lock.json ]]; then
    run_build_phase "$dir" 'Dependency installation' "${extra_env[@]}" npm ci --no-audit --no-fund
  else
    run_build_phase "$dir" 'Dependency installation' "${extra_env[@]}" npm install --no-audit --no-fund
  fi
  ok 'Dependencies installed'

  note 'Building the production bundle...'
  # APP_BASE=/ because this install is served from the domain root.
  run_build_phase "$dir" 'Production build' "${extra_env[@]}" env APP_BASE=/ npm run build
  BUILD_DIR="$dir/dist"
  ok 'Build finished'
  return 0
}

use_prebuilt() {
  BUILD_DIR=$(readlink -f "$OPT_DIST")
  ok "Using the ready output: $BUILD_DIR"
  return 0
}

# Validate the output before touching the site. The three files existing is
# not enough: the build must have used the right base, and the service worker
# must have been generated from these files.
validate_build() {
  local dir=$1 f
  local required=(index.html manifest.webmanifest sw.js)
  for f in "${required[@]}"; do
    [[ -f $dir/$f ]] || die "Required file missing from the build: $f"
  done

  if ! grep -q 'id="root"' "$dir/index.html"; then
    die 'index.html is not from this app (no id="root" found).'
  fi

  # A build with the wrong APP_BASE points at a subpath, and on a domain root
  # every one of those requests 404s.
  if grep -qE '(src|href)="[^"]*/fit-tracker-pwa/' "$dir/index.html"; then
    die 'This build targets GitHub Pages (paths under /fit-tracker-pwa/). Rebuild with APP_BASE=/.'
  fi

  local refs a
  local missing_assets=0 total_assets=0
  refs=$(grep -oE '(src|href)="[^"]*/assets/[^"]+"' "$dir/index.html" |
    sed -E 's/.*="([^"]*)".*/\1/' | sort -u) || true
  while IFS= read -r a; do
    [[ -n $a ]] || continue
    total_assets=$((total_assets + 1))
    [[ -f $dir${a} ]] || {
      bad "A file referenced by index.html is missing: $a"
      missing_assets=$((missing_assets + 1))
    }
  done <<<"$refs"
  if [[ $total_assets -eq 0 ]]; then
    die 'index.html references no assets; the build output is incomplete.'
  fi
  [[ $missing_assets -eq 0 ]] ||
    die "$missing_assets file(s) referenced by index.html are missing from the build."

  if ! grep -q 'precacheAndRoute\|workbox' "$dir/sw.js"; then
    die 'sw.js is not the service worker for this app (no workbox marker).'
  fi
  ok "Build output is valid ($total_assets assets checked)"
  return 0
}

# -------------------------------------------------------------- deploy -----
SITE_ROOT=''
RELEASES_DIR=''
CURRENT_LINK=''
PREVIOUS_MARK=''
SWAP_DONE=0
NEED_NGINX_RELOAD=0

init_paths() {
  SITE_ROOT=$OPT_WEBROOT
  RELEASES_DIR="$SITE_ROOT/releases"
  CURRENT_LINK="$SITE_ROOT/current"
  PREVIOUS_MARK="$SITE_ROOT/.previous"
}

write_if_changed() {
  # write_if_changed <path>: content is read from stdin.
  # Exit 0 means the file changed, 1 means the content was identical.
  local target=$1 tmp
  tmp=$(mktemp -t hamgam-wic.XXXXXX) || {
    warn "Could not create a temp file; writing $target without comparing."
    mkdir -p "$(dirname "$target")"
    cat >"$target"
    return 0
  }
  cat >"$tmp"
  if [[ -f $target ]] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$target")"
  # Callers use this as an `if` condition, which suspends errexit for the whole
  # call, and "unchanged" is also a non-zero return. So a write that fails has
  # to announce itself, or the caller would treat a broken config as current.
  install -m 0644 "$tmp" "$target" || {
    rm -f "$tmp"
    warn "Could not write $target."
    return 1
  }
  rm -f "$tmp"
  return 0
}

current_release() {
  if [[ -L $CURRENT_LINK ]]; then
    readlink -f "$CURRENT_LINK"
  fi
  return 0
}

# Carry the previous release's hashed assets into the new one, so a tab
# still running the old version does not 404 when it loads an old chunk.
merge_previous_assets() {
  local new_dir=$1 prev_dir=$2
  [[ -n $prev_dir && -d $prev_dir/assets && -d $new_dir/assets ]] || return 0
  local f base kept=0
  for f in "$prev_dir"/assets/*; do
    [[ -e $f ]] || continue
    base=$(basename "$f")
    [[ -e $new_dir/assets/$base ]] && continue
    if cp -p "$f" "$new_dir/assets/$base" 2>>"$LOG_PATH"; then
      kept=$((kept + 1))
    else
      warn "Could not keep the old file: $base"
    fi
  done
  if [[ $kept -gt 0 ]]; then
    note "$kept hashed file(s) from the previous release were kept"
  fi
  return 0
}

# Older versions of this script deployed a flat directory. Convert it into
# a release first, so nothing is lost.
migrate_legacy_layout() {
  [[ -d $SITE_ROOT ]] || return 0
  [[ -e $CURRENT_LINK ]] && return 0
  [[ -f $SITE_ROOT/index.html ]] || return 0

  local legacy
  legacy="$RELEASES_DIR/legacy-$(date +%Y%m%d-%H%M%S)"
  note 'Found the old flat layout; moving it into the release layout.'
  mkdir -p "$legacy"
  local entry
  for entry in "$SITE_ROOT"/* "$SITE_ROOT"/.[!.]*; do
    [[ -e $entry ]] || continue
    [[ $entry == "$RELEASES_DIR" ]] && continue
    [[ $entry == "$CURRENT_LINK" ]] && continue
    mv "$entry" "$legacy/" || die "Could not move $entry."
  done
  if [[ -f $legacy/index.html ]]; then
    # Point the symlink at the migrated release immediately. Otherwise, between
    # now and the swap, nginx's root points at an empty path and the site 404s.
    atomic_swap "$legacy" || die 'Could not create the release symlink after migrating.'
    printf '%s\n' "$legacy" >"$PREVIOUS_MARK"
  fi
  ok "The old layout was preserved in $legacy"
  return 0
}

# Atomic symlink swap: create a temporary link, then rename it into place.
atomic_swap() {
  local target=$1
  ln -sfn "$target" "$SITE_ROOT/.current.tmp" || return 1
  mv -T "$SITE_ROOT/.current.tmp" "$CURRENT_LINK" || return 1
  return 0
}

rollback_deploy() {
  local prev=''
  [[ -r $PREVIOUS_MARK ]] && prev=$(cat "$PREVIOUS_MARK")
  if [[ -z $prev || ! -d $prev ]]; then
    warn 'There is no previous release to roll back to.'
    return 0
  fi
  if atomic_swap "$prev"; then
    SWAP_DONE=0
    systemctl reload nginx 2>/dev/null || true
    note "Rolled the site back to: $prev"
  else
    warn "Automatic rollback failed. Run by hand: ln -sfn $prev $CURRENT_LINK && systemctl reload nginx"
  fi
  return 0
}

deploy_files() {
  step 'Deploying the site files'

  have rsync || die 'rsync is not installed.'
  init_paths
  guard_webroot "$SITE_ROOT"
  local new_root=0
  [[ -e $SITE_ROOT ]] || new_root=1
  mkdir -p "$RELEASES_DIR"
  if [[ $new_root -eq 1 ]]; then record_if_installing tree "$SITE_ROOT"; fi

  local stamp release
  stamp=$(date +%Y%m%d-%H%M%S)
  release="$RELEASES_DIR/${stamp}-${BUILD_ID}"
  if [[ -e $release ]]; then
    die "Release directory already exists: $release (try again in a minute)"
  fi

  migrate_legacy_layout

  local prev_release
  prev_release=$(current_release)

  note "Building the new release in $release"
  mkdir -p "$release"
  record_if_installing tree "$release"
  if ! run_logged rsync -a --chmod=D755,F644 "$BUILD_DIR/" "$release/"; then
    rm -rf "$release"
    die 'Copying files into the new release failed.'
  fi

  merge_previous_assets "$release" "$prev_release"

  # Record the previous release for rollback, before the swap. If there is none
  # (a fresh install) the marker is left alone: it may have been set by the
  # legacy migration and is still needed for rollback.
  if [[ -n $prev_release ]]; then
    printf '%s\n' "$prev_release" >"$PREVIOUS_MARK"
  fi

  chown -R www-data:www-data "$release"
  find "$release" -type d -exec chmod 755 {} +
  find "$release" -type f -exec chmod 644 {} +

  # From here on, any error triggers an automatic rollback.
  SWAP_DONE=1
  atomic_swap "$release" || {
    SWAP_DONE=0
    die 'The atomic release swap failed.'
  }
  record_if_installing link "$CURRENT_LINK"
  if [[ -f $PREVIOUS_MARK ]]; then record_if_installing file "$PREVIOUS_MARK"; fi
  NEED_NGINX_RELOAD=1
  ok "New release is live: $(basename "$release")"

  systemctl reload nginx 2>/dev/null || true

  # Keep the newest releases and prune the rest. A failed prune must not stop
  # the install. Important: the live release and the rollback target are never
  # pruned, or rollback would point at a path that no longer exists.
  local old keep_current keep_previous
  keep_current=$(current_release)
  keep_previous=''
  [[ -r $PREVIOUS_MARK ]] && keep_previous=$(cat "$PREVIOUS_MARK")
  while IFS= read -r old; do
    [[ -n $old ]] || continue
    [[ $old == "$RELEASES_DIR/"* ]] || continue
    [[ $old == "$keep_current" ]] && continue
    [[ $old == "$keep_previous" ]] && continue
    rm -rf "$old" 2>/dev/null || warn "Could not prune the old release: $old"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | tail -n "+$((RELEASES_KEEP + 1))" | cut -d' ' -f2-)

  return 0
}

# -------------------------------------------------------- nginx config ---
write_headers_snippet() {
  local csp_line=''
  if [[ $OPT_ENABLE_CSP -eq 1 ]]; then
    # style-src needs unsafe-inline because Recharts and Framer Motion write
    # styles as style attributes. script-src stays strict.
    csp_line='add_header Content-Security-Policy "default-src '"'"'self'"'"'; script-src '"'"'self'"'"'; style-src '"'"'self'"'"' '"'"'unsafe-inline'"'"'; img-src '"'"'self'"'"' data: blob:; font-src '"'"'self'"'"'; connect-src '"'"'self'"'"'; manifest-src '"'"'self'"'"'; worker-src '"'"'self'"'"'; object-src '"'"'none'"'"'; base-uri '"'"'self'"'"'; form-action '"'"'none'"'"'; frame-ancestors '"'"'none'"'"'" always;'
  fi

  if write_if_changed "$HEADERS_SNIPPET" <<EOF
# Generated by deploy/install.sh; do not edit by hand.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()" always;
$csp_line
EOF
  then
    note 'Security headers written'
  else
    note 'Security headers unchanged'
  fi
  return 0
}

# The cache policy lives in one map. That way no location has its own
# add_header, so the server-level security headers are inherited and the
# snippet does not need repeating in every location. (add_header_inherit
# merge only exists from nginx 1.29.3 and is not on Ubuntu 22.04.)
write_cache_map() {
  if write_if_changed "$CACHE_MAP" <<'EOF'
# Generated by deploy/install.sh; do not edit by hand.
# Hashed assets never change; the app shell, service worker and manifest
# must never be cached, or a new release never reaches the user.
map $uri $hamgam_cache {
    default                            "no-cache";
    ~^/assets/                         "public, max-age=31536000, immutable";
    ~^/workbox-[A-Za-z0-9_-]+\.js$     "no-cache, must-revalidate";
    =/index.html                       "no-cache, must-revalidate";
    =/sw.js                            "no-cache, must-revalidate";
    =/manifest.webmanifest             "no-cache, must-revalidate";
    =/robots.txt                       "public, max-age=3600";
}
EOF
  then
    note 'Cache policy written'
  else
    note 'Cache policy unchanged'
  fi
  return 0
}

build_server_names() {
  local names=$OPT_DOMAIN
  if [[ -n $OPT_EXTRA_HOSTS ]]; then
    local extra
    extra=$(printf '%s' "$OPT_EXTRA_HOSTS" | tr ',' ' ' | xargs)
    names="$names $extra"
  fi
  names=$(printf '%s' "$names" | xargs)
  printf '%s' "$names"
}

site_config_has_certbot() {
  [[ -f $NGINX_SITE ]] && grep -q 'managed by Certbot' "$NGINX_SITE"
}

site_config_matches_domain() {
  [[ -f $NGINX_SITE ]] && grep -qE "^[[:space:]]*server_name[[:space:]].*\b${OPT_DOMAIN//./\\.}\b" "$NGINX_SITE"
}

render_site_config() {
  local server_names
  server_names=$(build_server_names)
  printf '# Generated by deploy/install.sh; managed Hamgam site.\n'
  if [[ $OPT_TLS_MODE == manual ]]; then
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_names;
    return 301 https://$OPT_DOMAIN\$request_uri;
}
EOF
  fi
  printf 'server {\n'
  if [[ $OPT_TLS_MODE == manual ]]; then
    cat <<EOF
    listen 443 ssl;
    listen [::]:443 ssl;
    ssl_certificate "$OPT_TLS_CERT";
    ssl_certificate_key "$OPT_TLS_KEY";
    ssl_protocols TLSv1.2 TLSv1.3;
EOF
  else
    printf '    listen 80;\n    listen [::]:80;\n'
  fi
  cat <<EOF
    server_name $server_names;
    root $CURRENT_LINK;
    index index.html;

    charset utf-8;
    server_tokens off;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml application/javascript application/json
               application/manifest+json image/svg+xml application/xml;

    include $HEADERS_SNIPPET;
    add_header Cache-Control \$hamgam_cache always;

    location = /manifest.webmanifest {
        default_type application/manifest+json;
    }

    # A missing file under /assets/ must 404 rather than fall through to index.html.
    # Everything else goes through location / and gets the file it asked for.
    location /assets/ {
        access_log off;
        try_files \$uri =404;
    }

    # Root path. HashRouter is in use, so the fallback is only a safety net.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Block dotfiles, except the certificate renewal path.
    location ~ /\.(?!well-known) {
        deny all;
    }

    access_log /var/log/nginx/hamgam.access.log;
    error_log /var/log/nginx/hamgam.error.log warn;
}
EOF
}

write_site_config() {
  local content status=0
  content=$(render_site_config) || die 'Could not render nginx configuration.'
  write_if_changed "$NGINX_SITE" <<<"$content" || status=$?
  [[ $status -le 1 ]] || die 'Could not write the nginx site.'
  return "$status"
}

# Configuration activation is independent from the release symlink transaction.
# On failure the previous config must be back on disk before the caller rolls back.
activate_site_config() (
  local backup status=0 p original_active=0
  local paths=("$NGINX_SITE" "$NGINX_LINK" "$HEADERS_SNIPPET" "$CACHE_MAP")
  backup=$(mktemp -d /tmp/hamgam-nginx.XXXXXXXX) || die 'Cannot stage nginx recovery files.'
  chmod 700 "$backup"
  for p in "${paths[@]}"; do
    if [[ -e $p || -L $p ]]; then
      mkdir -p "$backup$(dirname "$p")" || die 'Cannot stage nginx recovery.'
      cp -a -- "$p" "$backup$p" || die 'Cannot copy nginx recovery files.'
    fi
  done
  # shellcheck disable=SC2317  # called via EXIT trap in this transaction
  recover_nginx_config() {
    local result=$? failed=0
    trap - EXIT
    if [[ $result -ne 0 ]]; then
      for p in "${paths[@]}"; do
        rm -f -- "$p" || failed=1
        if [[ -e $backup$p || -L $backup$p ]]; then cp -a -- "$backup$p" "$p" || failed=1; fi
      done
      if [[ $original_active -eq 1 ]]; then
        nginx -t >>"$LOG_PATH" 2>&1 && systemctl reload nginx >>"$LOG_PATH" 2>&1 || failed=1
      fi
      if [[ $failed -ne 0 ]]; then
        warn "nginx recovery needs manual attention; files retained at $backup"
        exit "$result"
      fi
      warn 'Previous nginx configuration restored.'
    fi
    rm -rf -- "$backup"
    exit "$result"
  }
  trap recover_nginx_config EXIT
  systemctl is-active --quiet nginx && original_active=1
  write_headers_snippet
  write_cache_map
  if [[ $OPT_TLS_MODE != auto ]] || ! site_config_has_certbot || ! site_config_matches_domain; then
    write_site_config || status=$?
    [[ $status -le 1 ]] || die 'Could not stage the nginx site.'
  fi
  if [[ -L $NGINX_LINK ]]; then
    [[ $(readlink -f "$NGINX_LINK") == "$NGINX_SITE" ]] || die 'The Hamgam nginx link points at an unrelated file.'
  elif [[ -e $NGINX_LINK ]]; then
    die 'An unrelated file occupies the Hamgam nginx enabled-site path.'
  else
    ln -s "$NGINX_SITE" "$NGINX_LINK" || die 'Could not enable the nginx site.'
  fi
  nginx -t >>"$LOG_PATH" 2>&1 || die 'The new nginx configuration is invalid.'
  # reload returns 0 even when the master cannot bind a listener and keeps the
  # old configuration, so the exit status alone cannot prove the new file is
  # live. Old workers exiting is the observable evidence that it is.
  local old_workers='' worker_hung=0 w
  old_workers=$(pgrep -f '^nginx: worker process' || true)
  if [[ $original_active -eq 1 ]]; then
    systemctl reload nginx >>"$LOG_PATH" 2>&1 || die 'Reloading nginx failed.'
    if [[ -n $old_workers ]]; then
      for ((w = 0; w < 30; w++)); do
        worker_hung=0
        for pid in $old_workers; do kill -0 "$pid" 2>/dev/null && worker_hung=1; done
        [[ $worker_hung -eq 1 ]] || break
        sleep 1
      done
      [[ $worker_hung -eq 0 ]] || die 'nginx accepted the reload command but kept the previous workers; the new configuration is not live.'
    fi
  else
    systemctl start nginx >>"$LOG_PATH" 2>&1 || die 'Starting nginx failed.'
  fi
  systemctl is-active --quiet nginx || die 'nginx is not active after activation.'
  log "nginx activated; release reload requested=$NEED_NGINX_RELOAD"
  ok 'nginx configuration validated and activated'
)

handle_default_site() {
  [[ -e /etc/nginx/sites-enabled/default ]] || return 0
  if [[ $OPT_KEEP_DEFAULT_SITE -eq 1 ]]; then
    note 'The default nginx site was left alone (--keep-default-site)'
    return 0
  fi

  # The default site may genuinely be in use, and removing it would take down
  # another service on this server. So it is only disabled with explicit
  # consent, and the restore command is printed.
  # Note: it does not break our site, since our server_name is more specific;
  # only requests with no matching Host reach it.
  note 'The default nginx site is active on port 80.'
  note 'Our site works alongside it, but if this server only hosts this site, disabling it is cleaner.'
  if ask_yes_no 'Disable the default nginx site? (restore: sudo ln -s ../sites-available/default /etc/nginx/sites-enabled/default)' n; then
    rm -f /etc/nginx/sites-enabled/default
    note 'The default site was disabled'
  else
    note 'The default site was left alone'
  fi
  return 0
}

resolve_domain_conflicts() {
  local conflicts
  conflicts=$(grep -rlE "^[[:space:]]*server_name[[:space:]]+.*\b${OPT_DOMAIN//./\\.}\b" \
    /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -v "$NGINX_SITE" || true)
  [[ -n $conflicts ]] || return 0

  warn 'This domain is already defined in another nginx config:'
  local c
  while IFS= read -r c; do note "$c"; done <<<"$conflicts"
  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    ask_yes_no 'Disable that config to avoid a conflict?' y ||
      die 'Stopping to avoid a conflict.'
  fi
  while IFS= read -r c; do
    if [[ -L $c ]]; then
      rm -f "$c"
      note "Disabled: $c (restore: sudo ln -s /etc/nginx/sites-available/$(basename "$c") $c)"
    fi
  done <<<"$conflicts"
  return 0
}

configure_nginx() {
  step 'Configuring nginx'
  init_paths

  resolve_domain_conflicts
  handle_default_site
  local status=0
  activate_site_config || { status=$?; stop_install "$status"; }
  record_nginx_resources
  NEED_NGINX_RELOAD=0
  run_logged systemctl enable nginx >/dev/null 2>&1 || true
  ok 'nginx is active and enabled at boot'
  return 0
}

# ------------------------------------------------------------ firewall -----
configure_firewall() {
  step 'Checking the firewall'

  if ! have ufw; then
    note 'ufw is not installed; nothing to configure.'
    return 0
  fi
  if ! ufw status 2>/dev/null | grep -q '^Status: active'; then
    # Enabling ufw automatically can cut off SSH access, so we never do it
    # without an explicit request.
    note 'ufw is inactive; leaving it alone. If you enable it, open ports 80 and 443.'
    return 0
  fi
  if ufw status | grep -qE '^(Nginx Full|80/tcp|443/tcp)'; then
    ok 'Ports 80 and 443 are open in the firewall'
    return 0
  fi
  note 'Opening ports 80 and 443 in ufw...'
  if ! run_logged ufw allow 'Nginx Full'; then
    warn 'Opening the ports in ufw failed; check by hand.'
    return 0
  fi
  ok 'Firewall updated'
  return 0
}

# ---------------------------------------------------------------- TLS -----
TLS_STATE='none'

# This check is diagnostic only. Behind Cloudflare or NAT, DNS deliberately
# points elsewhere and must not block a certificate that would otherwise
# issue.
dns_report() {
  local host=$1
  local v4 v6 public_ip ns
  v4=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  v6=$(getent ahostsv6 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  public_ip=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
  ns=$( (getent hosts "$host" >/dev/null 2>&1 && dig +short NS "$host" 2>/dev/null | tr '\n' ' ') || true)

  log "dns: $host A=[${v4}] AAAA=[${v6}] public=${public_ip} ns=[${ns}]"

  if [[ -z $v4 && -z $v6 ]]; then
    warn "Domain $host was not found in DNS."
    note 'If you just set the DNS up, give it a few minutes.'
  elif [[ -n $public_ip && " $v4 " == *" $public_ip "* ]]; then
    ok "The domain points at this server ($public_ip)"
  else
    note "DNS for the domain: IPv4=${v4:-none} IPv6=${v6:-none}"
    if [[ -n $public_ip ]]; then note "This server's public IP: $public_ip"; fi
    if [[ ${ns,,} == *cloudflare* ]]; then
      note 'The domain uses Cloudflare. With the orange cloud on, the edge address is what DNS returns,'
      note 'which is expected. In that case set SSL mode to Full (strict), not Flexible.'
    else
      note 'The server may be behind NAT, or the A record may point at a different server.'
    fi
    note 'certbot determines this definitively, so we continue.'
  fi
  return 0
}

# Does HTTPS work on this server, with the right SNI and without ignoring certificate errors?
https_works() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    --resolve "${OPT_DOMAIN}:443:127.0.0.1" "https://${OPT_DOMAIN}/") || return 1
  [[ $code == 200 ]]
}

enable_certbot_timer() {
  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    if run_logged systemctl enable --now certbot.timer; then
      ok 'Automatic renewal is enabled (certbot.timer)'
    else
      warn 'Enabling certbot.timer failed; check automatic renewal.'
    fi
  else
    warn 'certbot.timer not found; automatic renewal was not configured.'
  fi
  return 0
}

tls_troubleshooting() {
  ui_out ''
  bad 'No SSL certificate was issued.'
  note 'Without HTTPS the service worker and offline mode do not work, so this install is incomplete.'
  note 'How to fix it:'
  note "  * Behind Cloudflare: set SSL mode to Full (strict), or issue with DNS-01:"
  note "      sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials <file> -d $OPT_DOMAIN"
  note '  * Behind NAT: port 80 must reach this server from the outside.'
  note "  * Point the domain's A/AAAA record at this server, then: sudo certbot --nginx -d $OPT_DOMAIN"
  note "  * Error details: grep -i 'certbot\\|acme' $LOG_FILE"
  ui_out ''
  return 0
}

setup_tls() {
  step 'Installing the SSL certificate'

  if [[ $OPT_TLS_MODE == manual ]]; then
    TLS_STATE=manual
    note 'Using external TLS files; renewal and nginx reload are your responsibility.'
    return 0
  fi

  if [[ $OPT_SKIP_TLS -eq 1 ]]; then
    warn 'No certificate installed, as requested (--skip-tls). The site stays on HTTP.'
    note 'Note: without HTTPS the service worker, offline mode and phone install do not work.'
    TLS_STATE='skipped'
    return 0
  fi

  if ! have certbot; then
    bad 'certbot was not installed; HTTPS was not set up.'
    tls_troubleshooting
    TLS_STATE='missing'
    return 0
  fi

  dns_report "$OPT_DOMAIN"

  local hosts_args=(-d "$OPT_DOMAIN")
  if [[ -n $OPT_EXTRA_HOSTS ]]; then
    local extra h
    IFS=',' read -ra extra <<<"$OPT_EXTRA_HOSTS"
    for h in "${extra[@]}"; do
      h=$(printf '%s' "$h" | xargs)
      [[ -n $h ]] && hosts_args+=(-d "$h")
    done
  fi

  if [[ -d /etc/letsencrypt/live/$OPT_DOMAIN ]]; then
    note 'A certificate exists; checking renewal.'
    if https_works; then
      ok 'HTTPS works with the existing certificate'
      TLS_STATE='existing'
      enable_certbot_timer
      return 0
    fi
    warn 'A certificate exists but HTTPS does not respond correctly; requesting again.'
  fi

  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    if ! ask_yes_no "Install a free Let's Encrypt certificate for $OPT_DOMAIN?" y; then
      warn 'Certificate install declined; the site stays on HTTP and offline will not work.'
      TLS_STATE='declined'
      return 0
    fi
  fi

  note "Requesting a certificate from Let's Encrypt..."
  local certbot_args=(--non-interactive --agree-tos --no-eff-email -m "$OPT_EMAIL")
  if [[ -n $OPT_CF_CREDENTIALS ]]; then
    certbot_args+=(certonly --dns-cloudflare --dns-cloudflare-credentials "$OPT_CF_CREDENTIALS")
    local h
    for h in "${hosts_args[@]}"; do
      [[ $h == -d ]] && continue
      certbot_args+=(-d "$h")
    done
  else
    certbot_args+=(--nginx --redirect "${hosts_args[@]}")
  fi

  if certbot "${certbot_args[@]}" >>"$LOG_PATH" 2>&1; then
    ok 'Certificate issued'
  else
    tls_troubleshooting
    TLS_STATE='failed'
    # The config may have been left half-changed; validating it.
    if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
      warn 'The nginx config is not valid after the failed certbot attempt.'
      write_site_config || true
      if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
        die 'The nginx config needs manual review. nginx was not reloaded.'
      fi
      note 'The config was restored to the HTTP template'
    fi
    run_logged systemctl reload nginx || true
    return 0
  fi

  if [[ -n $OPT_CF_CREDENTIALS ]]; then
    # With DNS-01, certbot writes the certificate but leaves the nginx config
    # alone, so the HTTPS template is generated with certbot install --nginx.
    if certbot install --nginx --non-interactive --redirect "${hosts_args[@]}" >>"$LOG_PATH" 2>&1; then
      ok 'The nginx config was updated for HTTPS'
    else
      warn 'Installing the certificate into nginx failed.'
    fi
  fi

  # certbot may have rewritten the config; validating it again.
  if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
    warn 'certbot changed the config and it is no longer valid; rewriting ours.'
    write_site_config || true
    if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
      die 'The nginx config needs manual review after certbot. nginx was not reloaded.'
    fi
    warn 'The config went back to the HTTP template; HTTPS needs manual setup.'
  fi
  run_logged systemctl reload nginx || true

  if https_works; then
    ok 'HTTPS works with the new certificate'
    TLS_STATE='issued'
    enable_certbot_timer
  else
    tls_troubleshooting
    TLS_STATE='failed'
  fi
  return 0
}

# ------------------------------------------------------- health check --------
HEALTH_FAILED=0
HEALTH_WARNED=0
SCHEME='http'

health_pass() { ok "$1"; }
health_fail() { bad "$1"; HEALTH_FAILED=$((HEALTH_FAILED + 1)); }

# Requests use the right SNI and Host and do not ignore certificate
# errors, so we never accidentally test the default server or the Cloudflare
# edge.
curl_here() {
  curl -sS --max-time 15 \
    --resolve "${OPT_DOMAIN}:80:127.0.0.1" \
    --resolve "${OPT_DOMAIN}:443:127.0.0.1" "$@"
}

check_path() {
  # check_path <path> <expected code> <optional header pattern>
  local path=$1 expect=$2 header=${3:-}
  local url="${SCHEME}://${OPT_DOMAIN}${path}"
  local code
  code=$(curl_here -o /tmp/hamgam-health-body -w '%{http_code}' "$url" 2>/dev/null) || code=000
  if [[ $code != "$expect" ]]; then
    health_fail "$path returned $code (expected $expect)"
    return 1
  fi
  if [[ -n $header ]]; then
    if ! curl_here -sI "$url" 2>/dev/null | grep -qi "$header"; then
      health_fail "Header $header is not set for $path"
      return 1
    fi
  fi
  return 0
}

health_check() {
  step 'Service health check'
  init_paths

  SCHEME='http'
  if https_works; then SCHEME='https'; fi

  # 1) Config validity and service state
  if nginx -t >/dev/null 2>>"$LOG_PATH"; then
    health_pass 'The nginx config is valid'
  else
    health_fail 'The nginx config is not valid'
  fi
  if systemctl is-active --quiet nginx; then
    health_pass 'The nginx service is running'
  else
    health_fail 'The nginx service is not running'
  fi

  if [[ ! -L $CURRENT_LINK ]]; then
    health_fail "The live release symlink is missing: $CURRENT_LINK"
  else
    local cur
    cur=$(current_release)
    if [[ -f $cur/index.html && -f $cur/sw.js ]]; then
      health_pass "The live release is healthy: $(basename "$cur")"
    else
      health_fail "The live release is incomplete: $cur"
    fi
  fi

  # 2) Key files and headers
  if check_path / 200; then health_pass 'The home page returns 200'; fi

  if curl_here "${SCHEME}://${OPT_DOMAIN}/" 2>/dev/null | grep -q 'id="root"'; then
    health_pass 'The home page has the expected structure'
  else
    health_fail 'The home page is missing the expected content'
  fi

  if check_path /index.html 200 'Cache-Control: *no-cache'; then
    health_pass 'index.html is served with no-cache'
  fi
  if check_path /sw.js 200 'Cache-Control: *no-cache'; then
    health_pass 'sw.js is served with no-cache'
  fi
  if check_path /manifest.webmanifest 200 'application/manifest+json'; then
    health_pass 'The manifest is served with the right type'
  fi

  # 3) Every asset the home page references must exist.
  local refs missing_assets=0 total_assets=0 a
  refs=$(grep -oE '(src|href)="[^"]*/assets/[^"]+"' "$CURRENT_LINK/index.html" 2>/dev/null |
    sed -E 's/.*="([^"]*)".*/\1/' | sort -u || true)
  while IFS= read -r a; do
    [[ -n $a ]] || continue
    total_assets=$((total_assets + 1))
    if ! check_path "$a" 200; then missing_assets=$((missing_assets + 1)); fi
  done <<<"$refs"
  if [[ $total_assets -eq 0 ]]; then
    health_fail 'index.html references no assets'
  elif [[ $missing_assets -eq 0 ]]; then
    health_pass "All $total_assets assets are healthy"
  fi

  # 4) immutable header on assets
  local first_asset
  first_asset=$(printf '%s\n' "$refs" | head -1)
  if [[ -n $first_asset ]]; then
    if curl_here -sI "${SCHEME}://${OPT_DOMAIN}${first_asset}" 2>/dev/null | grep -qi 'immutable'; then
      health_pass 'Assets are served with a long cache'
    else
      warn 'No immutable header on assets; loading will be a little slower.'
      HEALTH_WARNED=$((HEALTH_WARNED + 1))
    fi
  fi

  # 5) The service worker is really present
  if grep -q 'precacheAndRoute\|workbox' "$CURRENT_LINK/sw.js" 2>/dev/null; then
    health_pass 'The offline service worker was generated'
  else
    health_fail 'The service worker does not look valid'
  fi

  # 6) HTTPS is required for a PWA, not decorative.
  if [[ $OPT_SKIP_TLS -eq 0 ]]; then
    if https_works; then
      health_pass 'HTTPS works with a valid certificate'
      local code
      code=$(curl_here -o /dev/null -w '%{http_code}' "http://${OPT_DOMAIN}/" 2>/dev/null || true)
      if [[ $code =~ ^30[0-9]$ ]]; then
        health_pass 'HTTP redirects to HTTPS'
      else
        health_fail "HTTP does not redirect to HTTPS (got $code)"
      fi

      local expiry days
      local expiry_file="/etc/letsencrypt/live/$OPT_DOMAIN/cert.pem"
      if [[ $OPT_TLS_MODE == manual ]]; then expiry_file=$OPT_TLS_CERT; fi
      expiry=$(openssl x509 -enddate -noout -in "$expiry_file" 2>/dev/null |
        cut -d= -f2 || true)
      if [[ -n $expiry ]]; then
        days=$((($(date -d "$expiry" +%s) - $(date +%s)) / 86400))
        if [[ $days -gt 20 ]]; then
          health_pass "The SSL certificate is valid for $days more days"
        else
          health_fail "The SSL certificate has only $days days left; check renewal."
        fi
      fi
    else
      health_fail 'HTTPS is not working; without it the service worker and offline install do not work.'
    fi
  fi
  return 0
}

# ------------------------------------------------------------ summary ------
summary() {
  step 'Summary'

  local https_now=0
  if https_works; then https_now=1; fi
  local url="http://$OPT_DOMAIN"
  if [[ $https_now -eq 1 ]]; then url="https://$OPT_DOMAIN"; fi

  # HTTPS is required for a PWA; only an explicit --skip-tls exempts it.
  local tls_ok=0
  if [[ $OPT_SKIP_TLS -eq 1 || $https_now -eq 1 ]]; then tls_ok=1; fi

  local tls_note=''
  case $TLS_STATE in
    skipped) tls_note='No certificate was installed, as requested (--skip-tls).' ;;
    manual) tls_note='External TLS files are in use; arrange renewal and reload nginx after replacement.' ;;
    missing) tls_note='certbot was not installed, so no certificate could be issued.' ;;
    declined) tls_note='You declined the certificate install.' ;;
    failed) tls_note='The attempt to issue a certificate failed.' ;;
  esac

  ui_out ''
  if [[ $HEALTH_FAILED -eq 0 && $tls_ok -eq 1 ]]; then
    ui_out "${C_GREEN}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    panel_row "${C_GREEN}${C_BOLD}" 'Installation completed successfully'
    ui_out "${C_GREEN}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
  elif [[ $HEALTH_FAILED -eq 0 ]]; then
    ui_out "${C_YELLOW}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    panel_row "${C_YELLOW}${C_BOLD}" 'Installed, but HTTPS is not working'
    ui_out "${C_YELLOW}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
    if [[ -n $tls_note ]]; then note "$tls_note"; fi
    note 'The site opens over HTTP, but the service worker, offline mode and phone install do not work.'
    note 'This install is incomplete; follow the lines above to get a certificate.'
  else
    ui_out "${C_YELLOW}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    panel_row "${C_YELLOW}${C_BOLD}" "Installed, but $HEALTH_FAILED check(s) failed"
    ui_out "${C_YELLOW}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
    note 'Review the items above.'
  fi

  ui_out ''
  plain "  ${C_BOLD}Site address${C_RESET}"
  plain "    ${C_TEAL}${C_BOLD}$url${C_RESET}"
  ui_out ''
  plain "  ${C_BOLD}Details${C_RESET}"
  plain "    Domain               $OPT_DOMAIN"
  plain "    Live release         $(basename "$(current_release 2>/dev/null || printf 'unknown')")"
  plain "    Releases             $RELEASES_DIR"
  plain "    Live symlink         $CURRENT_LINK"
  plain "    nginx config         $NGINX_SITE"
  plain "    Settings file        $CONF_FILE"
  plain "    Install log          $LOG_FILE"
  ui_out ''

  plain "  ${C_BOLD}Installing on a phone${C_RESET}"
  note 'iPhone: open the site in Safari, tap Share, then Add to Home Screen, then Add'
  note 'Android: open the site in Chrome, open the three-dot menu, then Install app, then Install'
  ui_out ''

  plain "  ${C_BOLD}Next steps${C_RESET}"
  note "Update:   sudo bash $0 --update"
  note "Rollback: sudo bash $0 --rollback"
  note "Remove:   sudo bash $0 --uninstall"
  if [[ $OPT_SKIP_TLS -eq 1 || $tls_ok -eq 0 ]]; then
    if [[ $OPT_TLS_MODE == manual ]]; then
      note 'Check the supplied certificate/key and fullchain trust, then reload nginx.'
    else
      note "Get a certificate: sudo certbot --nginx -d $OPT_DOMAIN"
    fi
  fi
  note 'Final test: open the site, then cut the network and reload.'
  ui_out ''

  plain "  ${C_YELLOW}${C_BOLD}Important: where user data lives${C_RESET}"
  note 'User data stays only in the browser on each device (IndexedDB); the server holds no copy.'
  note 'This script backs up app files, not user data. Changing the domain, or'
  note 'moving HTTP to HTTPS, does not carry browser data across either.'
  ui_out ''

  if [[ $HEALTH_FAILED -gt 0 ]]; then
    plain "  ${C_YELLOW}Failed checks: $HEALTH_FAILED${C_RESET}"
    plain "  ${C_DIM}Related log lines: grep -iE 'fail|error' $LOG_FILE${C_RESET}"
    ui_out ''
    if [[ $SWAP_DONE -eq 1 ]]; then
      warn 'The new release is still live. If the site is unhealthy, roll back now:'
      note "  sudo bash $0 --rollback"
    fi
  fi

  if [[ $HEALTH_FAILED -gt 0 || $tls_ok -eq 0 ]]; then
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------- run ------
run_rollback() {
  init_paths
  guard_webroot "$SITE_ROOT"
  if ! systemctl is-active --quiet nginx; then
    warn 'nginx is not running; only the release symlink will be swapped.'
  fi
  rollback_deploy
  ok 'Rollback complete'
  return 0
}

main() {
  # Keep diagnostics from system tools in English, regardless of SSH locale.
  export LC_ALL=C
  parse_args "$@"
  if [[ $UNINSTALL_ONLY -eq 1 ]]; then
    need_root "$@"
    acquire_lock
    run_uninstall
    return
  fi
  init_log "$@"
  need_root "$@"
  acquire_lock
  init_paths
  banner

  if [[ $ROLLBACK_ONLY -eq 1 ]]; then
    collect_config
    run_rollback
    return 0
  fi

  preflight
  collect_config
  inventory_begin
  record_if_installing log "$LOG_FILE"
  # Keep last-good TLS settings until activation has succeeded.

  # The summary returns non-zero when health checks failed. That is an outcome
  # to report, not an abort, so it must not reach the error trap: the release
  # stays live and rolling back is the operator's call. A `return` would hand a
  # non-zero status to the top-level caller under set -e, where the trap would
  # read it as a crash, print a second closing banner and undo a finished
  # install. `exit` carries the status out without any of that.
  local outcome=0
  if [[ $UPDATE_ONLY -eq 1 ]]; then
    # Update mode still takes the lock, validates the build, supports rollback
    # and runs the health check; only system packages and the nginx config are
    # left alone.
    fetch_and_build
    deploy_files
    configure_nginx
    setup_tls
    save_config
    health_check
    summary || outcome=$?
  else
    install_packages
    fetch_and_build
    deploy_files
    configure_nginx
    configure_firewall
    setup_tls
    save_config
    health_check
    summary || outcome=$?
  fi
  exit "$outcome"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
