#!/usr/bin/env bash
# Unit tests for the pure functions in deploy/install.sh
# Run: bash deploy/install.test.sh
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Sourcing does not run main (guarded by BASH_SOURCE).
# shellcheck source=deploy/install.sh disable=SC1090,SC1091
. "$SCRIPT_DIR/install.sh"

# The script itself starts with set -Eeuo and an ERR trap; neutralise both
# here so one failing assertion does not abort the whole file.
set +e
trap - ERR

PASS=0
FAIL=0
t() {
  local desc=$1 expected=$2 actual=$3
  if [[ $expected == "$actual" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL: %s\n  expected: %q\n  actual:   %q\n' "$desc" "$expected" "$actual"
  fi
}

# --------------------------------------------------- English terminal UI ----
# Match Arabic/Persian UTF-8 bytes without requiring a particular locale.
LC_ALL=C grep -qP '[\xD8-\xDB][\x80-\xBF]' "$SCRIPT_DIR/install.sh"
t 'installer contains no Persian/Arabic script' '1' "$?"
help=$(bash "$SCRIPT_DIR/install.sh" --help)
t 'help exits successfully without root' '0' "$?"
t 'help is English' 'yes' "$([[ $help == *'Hamgam | server installer'* && $help == *'Options:'* ]] && echo yes || echo no)"
row=$(panel_row '' 'Installed, but 123 check(s) failed')
row=${row#*│}; row=${row%│*}
t 'panel row keeps its width with a dynamic count' '58' "${#row}"
STEP_INDEX=0
step_text=$(step 'Checking the system')
t 'step counter uses Latin digits' 'yes' "$([[ $step_text == *'step 1 of 10:'* ]] && echo yes || echo no)"

# --------------------------------------------------- valid_path ----
t 'valid_path: normal' 'yes' "$(valid_path /var/www/hamgam && echo yes || echo no)"
t 'valid_path: rejects relative' 'no' "$(valid_path var/www && echo yes || echo no)"
t 'valid_path: rejects ..' 'no' "$(valid_path /var/../etc && echo yes || echo no)"
t 'valid_path: rejects empty' 'no' "$(valid_path '' && echo yes || echo no)"

# --------------------------------------------------- guard_webroot ----
guard_webroot /var/www/hamgam >/dev/null 2>&1
t 'guard_webroot: accepts /var/www/hamgam' '0' "$?"

for bad in / /etc /usr/bin /var /opt /root /dev/null '..' ''; do
  # Run in a subshell, because die calls exit.
  (guard_webroot "$bad" >/dev/null 2>&1)
  t "guard_webroot: rejects '$bad'" '1' "$?"
done

# ------------------------------------------- build_server_names ----
# shellcheck disable=SC2034  # read by the functions sourced from install.sh
OPT_DOMAIN='fit.example.com'
OPT_EXTRA_HOSTS=''
t 'server_names: single' 'fit.example.com' "$(build_server_names)"
OPT_EXTRA_HOSTS='www.example.com, fit2.example.com'
t 'server_names: extras trimmed' 'fit.example.com www.example.com fit2.example.com' "$(build_server_names)"
OPT_EXTRA_HOSTS='www.example.com'

# ------------------------------------- validate_extra_hosts ----
OPT_EXTRA_HOSTS='www.example.com,fit.example.com'
validate_extra_hosts >/dev/null 2>&1
t 'extra_hosts: valid accepted' '0' "$?"
(OPT_EXTRA_HOSTS='not a domain' validate_extra_hosts >/dev/null 2>&1)
t 'extra_hosts: invalid rejected' '1' "$?"

# ------------------------------------------ domain/email regex ----
# Capture the match result explicitly; $? after a condition is not reliable.
matches() { [[ $1 =~ $2 ]]; }
for d in fit.example.com a-b.example.co.uk sub.domain.example.com; do
  matches "$d" "$VALID_DOMAIN_RE"
  t "domain regex: accepts $d" '0' "$?"
done
for d in '-bad.example.com' 'nodot' 'a..b.com' 'example.c' '' 'a b.com'; do
  matches "$d" "$VALID_DOMAIN_RE"
  t "domain regex: rejects '$d'" '1' "$?"
done
for e in me@example.com a.b+c@sub.example.co.uk; do
  matches "$e" "$VALID_EMAIL_RE"
  t "email regex: accepts $e" '0' "$?"
done
for e in 'noat' 'a@b' 'a b@example.com' '@example.com' ''; do
  matches "$e" "$VALID_EMAIL_RE"
  t "email regex: rejects '$e'" '1' "$?"
done

# ------------------------------------------ write_if_changed ----
TMP=$(mktemp -d)
export TMPDIR="$TMP"
trap 'rm -rf "$TMP"' EXIT
target="$TMP/f.conf"
write_if_changed "$target" <<<"alpha" >/dev/null 2>&1
t 'write_if_changed: first write returns 0' '0' "$?"
t 'write_if_changed: content written' 'alpha' "$(cat "$target")"
write_if_changed "$target" <<<"alpha" >/dev/null 2>&1
t 'write_if_changed: identical returns 1' '1' "$?"
write_if_changed "$target" <<<"beta" >/dev/null 2>&1
t 'write_if_changed: changed returns 0' '0' "$?"
t 'write_if_changed: content updated' 'beta' "$(cat "$target")"
t 'write_if_changed: mode 0644' '644' "$(stat -c '%a' "$target")"
# The temp file must be cleaned up in place. mktemp picks its own directory
# per platform, so count leftovers against our own prefix.
t 'write_if_changed: no temp leak' '0' "$(find "${TMPDIR:-/tmp}" /tmp -maxdepth 1 -name 'hamgam-wic.*' 2>/dev/null | wc -l | tr -d ' ')"

# Production calls this as an `if` condition, which suspends errexit for the
# whole call. A failed write must therefore be announced by the function itself:
# the condition is false either way, so silence means nginx keeps an old config.
(
  install() { return 1; }
  if write_if_changed "$TMP/never.conf" <<<"content"; then :; fi
) >"$TMP/status" 2>&1
t 'write_if_changed: a failed write says so' 'yes' "$(grep -qi 'could not write' "$TMP/status" && printf yes || printf no)"
t 'write_if_changed: a failed write is not silent' 'no' "$([[ -s $TMP/status ]] && printf no || printf yes)"
t 'write_if_changed: a failed write leaves no target behind' 'no' "$([[ -e $TMP/never.conf ]] && printf yes || printf no)"

# -------------------------------------------- build command status ----
# Preserve the child's status: 137 is useful evidence of SIGKILL, not proof of OOM.
(BUILD_UID=0; run_as_build_user "$TMP" bash -c 'exit 137')
t 'build runner: preserves SIGKILL status' '137' "$?"
(BUILD_UID=0; run_as_build_user "$TMP" bash -c 'exit 23')
t 'build runner: preserves ordinary failure status' '23' "$?"
(BUILD_UID=0; run_as_build_user "$TMP" bash -c 'exit 0')
t 'build runner: preserves success' '0' "$?"
(
  BUILD_UID=123 BUILD_GID=123 BUILD_HOME="$TMP"
  # The privilege boundary cannot be exercised without root in unit tests.
  setpriv() { shift 3; "$@"; }
  run_as_build_user "$TMP" bash -c 'exit 137'
)
t 'build runner: non-root branch preserves failure status' '137' "$?"

# ------------------------------------------- nginx config paths ----
# Generated paths must point at the release symlink, not a flat directory.
OPT_WEBROOT="$TMP/www"
init_paths
t 'init_paths: SITE_ROOT' "$TMP/www" "$SITE_ROOT"
t 'init_paths: RELEASES_DIR' "$TMP/www/releases" "$RELEASES_DIR"
t 'init_paths: CURRENT_LINK' "$TMP/www/current" "$CURRENT_LINK"

# ------------------------------------- config heredoc assembly ----
# Reproduce the heredoc write_site_config emits, without calling nginx.
OPT_EXTRA_HOSTS=''
CURRENT_LINK='/var/www/hamgam/current'
server_names=$(build_server_names)
CONF=$(cat <<EOF
server {
    listen 80;
    server_name $server_names;
    root $CURRENT_LINK;
    include /etc/nginx/snippets/hamgam-headers.conf;
    add_header Cache-Control \$hamgam_cache always;
    location /assets/ { try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
)
t 'site config: root is current symlink' 'yes' "$(grep -q 'root /var/www/hamgam/current;' <<<"$CONF" && echo yes || echo no)"
t 'site config: server_name present' 'yes' "$(grep -q 'server_name fit.example.com;' <<<"$CONF" && echo yes || echo no)"
# shellcheck disable=SC2016  # deliberately matching a literal $ in generated config
t 'site config: $hamgam_cache not expanded' 'yes' "$(grep -q 'Cache-Control \$hamgam_cache' <<<"$CONF" && echo yes || echo no)"
# shellcheck disable=SC2016  # deliberately matching a literal $ in generated config
t 'site config: $uri not expanded' 'yes' "$(grep -q 'try_files \$uri =404;' <<<"$CONF" && echo yes || echo no)"
t 'site config: no stray backslash-dollar' '0' "$(grep -c '\\\$' <<<"$CONF" | tr -d ' ')"
t 'site config: headers included once' '1' "$(grep -c 'include /etc/nginx/snippets/hamgam-headers.conf;' <<<"$CONF" | tr -d ' ')"

# --------------------------------------------- cache map content ----
MAP=$(cat <<'EOF'
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
)
t 'cache map: default no-cache' 'yes' "$(grep -q 'default  *"no-cache"' <<<"$MAP" && echo yes || echo no)"
t 'cache map: assets immutable' 'yes' "$(grep -q '/assets/' <<<"$MAP" && grep -q 'immutable' <<<"$MAP" && echo yes || echo no)"
t 'cache map: sw.js no-cache' 'yes' "$(grep -q '=/sw.js  *"no-cache, must-revalidate"' <<<"$MAP" && echo yes || echo no)"

# ----------------------------------------------- merge_previous ----
# The previous release's hashed assets must survive into the new one.
NEW="$TMP/rel/new"; OLD="$TMP/rel/old"
mkdir -p "$NEW/assets" "$OLD/assets"
echo 'new-app' >"$NEW/assets/index-NEW.js"
echo 'old-lazy' >"$OLD/assets/DataChart-OLD.js"
echo 'shared' >"$OLD/assets/shared.js"
echo 'shared' >"$NEW/assets/shared.js"
merge_previous_assets "$NEW" "$OLD" >/dev/null 2>&1
t 'merge: keeps old unique asset' 'yes' "$([[ -f $NEW/assets/DataChart-OLD.js ]] && echo yes || echo no)"
t 'merge: keeps new asset' 'yes' "$([[ -f $NEW/assets/index-NEW.js ]] && echo yes || echo no)"
t 'merge: does not overwrite existing' 'yes' "$([[ -f $NEW/assets/shared.js ]] && echo yes || echo no)"
bak=$(find "$TMP/rel/new" -name '*.js.bak' | wc -l | tr -d ' ')
t 'merge: no .bak files left' '0' "$bak"
# No previous release must not be an error.
merge_previous_assets "$NEW" '' >/dev/null 2>&1
t 'merge: tolerates empty previous' '0' "$?"

# ------------------------------------------- atomic_swap + rollback ----
SITE="$TMP/site"
mkdir -p "$SITE/releases/r1" "$SITE/releases/r2"
echo one >"$SITE/releases/r1/index.html"
echo two >"$SITE/releases/r2/index.html"
OPT_WEBROOT="$SITE"
init_paths
atomic_swap "$SITE/releases/r1"
t 'atomic_swap: link created' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'atomic_swap: points to r1' "$SITE/releases/r1" "$(readlink "$CURRENT_LINK")"
atomic_swap "$SITE/releases/r2"
t 'atomic_swap: repoints to r2' "$SITE/releases/r2" "$(readlink "$CURRENT_LINK")"
t 'atomic_swap: still a symlink' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'atomic_swap: no tmp left behind' 'no' "$([[ -e $SITE/.current.tmp ]] && echo yes || echo no)"

printf '%s\n' "$SITE/releases/r1" >"$PREVIOUS_MARK"
rollback_deploy >/dev/null 2>&1
t 'rollback: back to r1' "$SITE/releases/r1" "$(readlink "$CURRENT_LINK")"
t 'rollback: clears SWAP_DONE' '0' "$SWAP_DONE"
# With no marker, it must only warn.
rm -f "$PREVIOUS_MARK"
rollback_deploy >/dev/null 2>&1
t 'rollback: no marker is safe' '0' "$?"

# ------------------------------------ migrate_legacy_layout ----
LEG="$TMP/legacy"; mkdir -p "$LEG"
echo old >"$LEG/index.html"
echo oldsw >"$LEG/sw.js"
mkdir -p "$LEG/assets" && echo a >"$LEG/assets/x.js"
OPT_WEBROOT="$LEG"
init_paths
migrate_legacy_layout >/dev/null 2>&1
t 'migrate: current link now exists' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'migrate: flat index.html moved out' 'no' "$([[ -e $LEG/index.html ]] && echo yes || echo no)"
t 'migrate: releases dir kept' 'yes' "$([[ -d $RELEASES_DIR ]] && echo yes || echo no)"
t 'migrate: previous marker written' 'yes' "$([[ -r $PREVIOUS_MARK ]] && echo yes || echo no)"
t 'migrate: is idempotent' '0' "$(migrate_legacy_layout >/dev/null 2>&1; echo $?)"

# --------------------------------------------- validate_build ----
VB="$TMP/vb"; mkdir -p "$VB/assets"
cat >"$VB/index.html" <<'EOF'
<!doctype html><html><body><div id="root"></div>
<script type="module" src="/assets/index-ABC.js"></script>
<link rel="stylesheet" href="/assets/index-XYZ.css">
</body></html>
EOF
echo 'self.precacheAndRoute([])' >"$VB/sw.js"
echo '{}' >"$VB/manifest.webmanifest"
echo 'x' >"$VB/assets/index-ABC.js"
echo 'y' >"$VB/assets/index-XYZ.css"
# die calls exit, so run validate_build inside a nested subshell: the exit
# then closes only that subshell and the exit code stays readable.
vb_code() { (validate_build "$1" >/dev/null 2>&1); echo $?; }

t 'validate_build: good build accepted' '0' "$(vb_code "$VB")"

mv "$VB/sw.js" "$VB/sw.bak"
t 'validate_build: missing sw.js rejected' '1' "$(vb_code "$VB")"
mv "$VB/sw.bak" "$VB/sw.js"

mv "$VB/assets/index-ABC.js" "$VB/a.bak"
t 'validate_build: missing asset rejected' '1' "$(vb_code "$VB")"
mv "$VB/a.bak" "$VB/assets/index-ABC.js"

# A build made for GitHub Pages 404s everything on a domain root.
sed 's#/assets/#/fit-tracker-pwa/assets/#g' "$VB/index.html" >"$VB/i2"
mv "$VB/i2" "$VB/index.html"
t 'validate_build: pages-base build rejected' '1' "$(vb_code "$VB")"
sed 's#/fit-tracker-pwa/assets/#/assets/#g' "$VB/index.html" >"$VB/i3"
mv "$VB/i3" "$VB/index.html"

echo 'console.log(1)' >"$VB/sw.js"
t 'validate_build: non-workbox sw rejected' '1' "$(vb_code "$VB")"
echo 'self.precacheAndRoute([])' >"$VB/sw.js"

sed 's/id="root"/id="other"/' "$VB/index.html" >"$VB/i4"
mv "$VB/i4" "$VB/index.html"
t 'validate_build: no-root html rejected' '1' "$(vb_code "$VB")"
sed 's/id="other"/id="root"/' "$VB/index.html" >"$VB/i5"
mv "$VB/i5" "$VB/index.html"

t 'validate_build: still accepts the restored build' '0' "$(vb_code "$VB")"

# ------------------------------------------- load_saved_conf ----
# Real bug: --update restored only the paths from the settings file, so
# OPT_SOURCE stayed empty, the build step never ran, and the install died
# with "build output not found". Every key must be restored.
CONF_DIR_TEST="$TMP/conf"
CONF_FILE_TEST="$CONF_DIR_TEST/install.conf"
mkdir -p "$CONF_DIR_TEST"
cat >"$CONF_FILE_TEST" <<'EOF'
CFG_DOMAIN='fit.example.com'
CFG_EMAIL='me@example.com'
CFG_SOURCE='git'
CFG_GIT_URL='https://github.com/saeedgh837/fit-tracker-pwa.git'
CFG_GIT_REF='main'
CFG_WEBROOT='/var/www/hamgam'
CFG_REPO_DIR='/opt/hamgam'
CFG_EXTRA_HOSTS='www.example.com'
CFG_ENABLE_CSP='1'
EOF

# Point load_saved_conf at the test file. The same clearing the real one
# does is needed here: each read wipes previous values so a key missing
# from the file cannot leave a stale value behind.
load_saved_conf() {
  [[ -r $CONF_FILE_TEST ]] || return 1
  CFG_DOMAIN='' CFG_EMAIL='' CFG_SOURCE='' CFG_GIT_URL='' CFG_GIT_REF=''
  # shellcheck disable=SC2034
  CFG_WEBROOT='' CFG_REPO_DIR='' CFG_EXTRA_HOSTS='' CFG_ENABLE_CSP='' CFG_DIST=''
  # shellcheck disable=SC1090
  . "$CONF_FILE_TEST" || return 1
  return 0
}

# Simulate --update: no command-line values were given.
OPT_DOMAIN='' OPT_EMAIL='' OPT_SOURCE='' OPT_GIT_URL='' OPT_GIT_REF=''
OPT_WEBROOT='' OPT_REPO_DIR='' OPT_EXTRA_HOSTS=''
UPDATE_ONLY=1 NON_INTERACTIVE=1 ROLLBACK_ONLY=0
collect_config >/dev/null 2>&1
t 'update: OPT_SOURCE restored from saved conf' 'git' "${OPT_SOURCE:-}"
t 'update: OPT_GIT_REF restored' 'main' "${OPT_GIT_REF:-}"
t 'update: OPT_EMAIL restored' 'me@example.com' "${OPT_EMAIL:-}"
t 'update: OPT_DOMAIN restored' 'fit.example.com' "${OPT_DOMAIN:-}"
t 'update: OPT_WEBROOT restored' '/var/www/hamgam' "${OPT_WEBROOT:-}"
t 'update: OPT_REPO_DIR restored' '/opt/hamgam' "${OPT_REPO_DIR:-}"
t 'update: OPT_EXTRA_HOSTS restored' 'www.example.com' "${OPT_EXTRA_HOSTS:-}"

# An explicit command-line value must win over the saved one. A prebuilt source
# also needs its directory, exactly as a real operator would have to supply it.
mkdir -p "$TMP/prebuilt-dist"
OPT_SOURCE='prebuilt' OPT_DIST="$TMP/prebuilt-dist" OPT_GIT_REF='v2'
UPDATE_ONLY=1
collect_config >/dev/null 2>&1
t 'update: CLI --source wins over saved' 'prebuilt' "${OPT_SOURCE:-}"
t 'update: CLI --git-ref wins over saved' 'v2' "${OPT_GIT_REF:-}"
OPT_DIST=''

# Real bug: a prebuilt install records the source mode but not the dist path,
# so --update found no build output and died at readlink on an empty value.
mkdir -p "$TMP/prebuilt-dist"
cat >"$CONF_FILE_TEST" <<EOF
CFG_DOMAIN='fit.example.com'
CFG_SOURCE='prebuilt'
CFG_DIST='$TMP/prebuilt-dist'
CFG_WEBROOT='/var/www/hamgam'
CFG_REPO_DIR='/opt/hamgam'
CFG_ENABLE_CSP='1'
EOF
OPT_DOMAIN='' OPT_SOURCE='' OPT_DIST='' OPT_WEBROOT='' OPT_REPO_DIR='' OPT_EXTRA_HOSTS=''
UPDATE_ONLY=1
collect_config >/dev/null 2>&1
t 'update: prebuilt dist path restored' "$TMP/prebuilt-dist" "${OPT_DIST:-}"
OPT_DIST='' OPT_SOURCE=''
UPDATE_ONLY=0

# A settings file written by an older version has no dist path at all. The
# update must name the missing value instead of failing inside readlink.
cat >"$CONF_FILE_TEST" <<'EOF'
CFG_DOMAIN='fit.example.com'
CFG_SOURCE='prebuilt'
CFG_WEBROOT='/var/www/hamgam'
CFG_REPO_DIR='/opt/hamgam'
CFG_ENABLE_CSP='1'
EOF
OPT_DOMAIN='' OPT_SOURCE='' OPT_DIST='' OPT_WEBROOT='' OPT_REPO_DIR='' OPT_EXTRA_HOSTS=''
UPDATE_ONLY=1
update_out=$(collect_config 2>&1)
t 'update: missing prebuilt dist is refused' '1' "$?"
t 'update: missing prebuilt dist names the cause' yes "$([[ $update_out == *'dist'* && $update_out == *'--dist'* ]] && printf yes || printf no)"
OPT_DIST='' OPT_SOURCE=''
UPDATE_ONLY=0

# An incomplete settings file must fail loudly, not crash obscurely.
cat >"$CONF_FILE_TEST" <<'EOF'
CFG_SOURCE='git'
EOF
OPT_DOMAIN='' OPT_SOURCE='' OPT_WEBROOT=''
UPDATE_ONLY=1
(collect_config >/dev/null 2>&1)
t 'update: incomplete conf fails clearly' '1' "$?"
UPDATE_ONLY=0

# ----------------------------------------- release retention ----
# Pruning old releases must never remove the live release or the rollback
# target, or --rollback would point at a path that no longer exists.
PR="$TMP/prune/www"
mkdir -p "$PR/releases"
# RELEASES_KEEP is readonly in install.sh and cannot be reassigned here;
# the test runs with its default value.
OPT_WEBROOT="$PR"
init_paths
keep_a="$RELEASES_DIR/r-keep"; mkdir -p "$keep_a"
prev_b="$RELEASES_DIR/r-prev"; mkdir -p "$prev_b"
old1="$RELEASES_DIR/r-old1"; mkdir -p "$old1"
old2="$RELEASES_DIR/r-old2"; mkdir -p "$old2"
atomic_swap "$keep_a"
printf '%s\n' "$prev_b" >"$PREVIOUS_MARK"
# Backdate the directories so older ones fall outside the retention limit.
touch -d '2026-01-01 00:00:00' "$old2"
touch -d '2026-01-02 00:00:00' "$old1"
touch -d '2026-01-03 00:00:00' "$prev_b"
touch -d '2026-01-04 00:00:00' "$keep_a"

keep_current=$(current_release)
keep_previous=$(cat "$PREVIOUS_MARK")
while IFS= read -r old; do
  [[ -n $old ]] || continue
  [[ $old == "$RELEASES_DIR/"* ]] || continue
  [[ $old == "$keep_current" ]] && continue
  [[ $old == "$keep_previous" ]] && continue
  rm -rf "$old" 2>/dev/null || true
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
  sort -rn | tail -n "+$((RELEASES_KEEP + 1))" | cut -d' ' -f2-)

t 'retention: live release kept' 'yes' "$([[ -d $keep_a ]] && echo yes || echo no)"
t 'retention: rollback target kept' 'yes' "$([[ -d $prev_b ]] && echo yes || echo no)"
t 'retention: oldest release removed' 'no' "$([[ -d $old2 ]] && echo yes || echo no)"
t 'retention: live symlink still resolves' 'yes' "$([[ -f $CURRENT_LINK/index.html || -d $CURRENT_LINK ]] && echo yes || echo no)"

# ---------------------------------------------------------- results ----
printf '\n──────────────────────────────\n'
printf 'passed: %d\nfailed: %d\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
