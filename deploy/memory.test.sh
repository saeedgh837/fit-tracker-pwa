#!/usr/bin/env bash
# Memory policy tests; no test activates swap or changes the host configuration.
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/install.sh disable=SC1090,SC1091
. "$SCRIPT_DIR/install.sh"
set +e
trap - ERR
PASS=0 FAIL=0
t() {
  if [[ $2 == "$3" ]]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1))
    printf 'FAIL: %s\n  expected: %q\n  actual:   %q\n' "$1" "$2" "$3"
  fi
}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Defaults and parsing must not turn a general confirmation into swap consent.
t 'swap creation is opt-in by default' off "${OPT_SWAP:-missing}"
(
  parse_args --non-interactive --yes
  t 'noninteractive yes does not authorize swap' off "${OPT_SWAP:-missing}"
  [[ ${OPT_SWAP:-} == off ]]
)
t 'default remains off after confirmation flags' 0 "$?"
(parse_args --swap=invalid) >"$TMP/invalid" 2>&1
t 'invalid swap policy rejected' 1 "$?"
policy=$(parse_args --swap=auto; printf '%s' "${OPT_SWAP:-missing}")
t 'explicit auto accepted' auto "$policy"
policy=$(parse_args --swap off; printf '%s' "${OPT_SWAP:-missing}")
t 'separate swap argument accepted' off "$policy"

cat >"$TMP/meminfo" <<'EOF'
MemTotal:        4194304 kB
MemAvailable:   3072000 kB
SwapTotal:      3145728 kB
SwapFree:       2097152 kB
EOF
mkdir -p "$TMP/cg/team/job"
printf 'cpu memory\n' >"$TMP/cg/cgroup.controllers"
printf '0::/team/job\n' >"$TMP/cgroup"
for dir in "$TMP/cg/team" "$TMP/cg/team/job"; do
  printf 'max\n' >"$dir/memory.max"
  printf '0\n' >"$dir/memory.current"
  printf 'max\n' >"$dir/memory.swap.max"
  printf '0\n' >"$dir/memory.swap.current"
  printf 'oom 0\noom_kill 0\n' >"$dir/memory.events"
done
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'unlimited group uses physical RAM' 4096 "${BUILD_MEM_MB:-missing}"
t 'unlimited group uses available memory' 3000 "${BUILD_AVAIL_MB:-missing}"
t 'unlimited group uses free swap, not total' 2048 "${BUILD_SWAP_FREE_MB:-missing}"
t 'unlimited hierarchy is understood' 1 "${BUILD_MEMORY_KNOWN:-missing}"
t 'unlimited hierarchy is not restricted' 0 "${BUILD_MEMORY_RESTRICTED:-missing}"

# A namespaced root is not the global root, even when its own limits say max.
# A hidden ancestor can impose a limit that cannot be inferred from host RAM.
printf 'max\n' >"$TMP/cg/memory.max"
printf 'max\n' >"$TMP/cg/memory.swap.max"
printf '0\n' >"$TMP/cg/memory.current"
printf '0\n' >"$TMP/cg/memory.swap.current"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'namespaced root with hidden ancestors is not trusted' 0 "${BUILD_MEMORY_KNOWN:-missing}"
rm "$TMP/cg/memory.max" "$TMP/cg/memory.swap.max"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'unconstrained real cgroup root is supported' 1 "${BUILD_MEMORY_KNOWN:-missing}"

# A parent, not the leaf, supplies the tightest limits.
printf '2147483648\n' >"$TMP/cg/team/job/memory.max"
printf '1073741824\n' >"$TMP/cg/team/memory.max"
printf '268435456\n' >"$TMP/cg/team/memory.current"
printf '805306368\n' >"$TMP/cg/team/memory.swap.max"
printf '134217728\n' >"$TMP/cg/team/memory.swap.current"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'finite ancestor bounds RAM' 1024 "${BUILD_MEM_MB:-missing}"
t 'finite ancestor bounds memory headroom' 768 "${BUILD_AVAIL_MB:-missing}"
t 'finite ancestor bounds usable swap headroom' 640 "${BUILD_SWAP_FREE_MB:-missing}"
t 'finite ancestor prevents host swap mutation' 1 "${BUILD_MEMORY_RESTRICTED:-missing}"
printf '0\n' >"$TMP/cg/team/memory.swap.max"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'zero cgroup swap allowance overrides host swap' 0 "${BUILD_SWAP_FREE_MB:-missing}"
rm "$TMP/cg/team/job/memory.swap.current"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /
t 'missing accounting is not treated as unlimited' 0 "${BUILD_MEMORY_KNOWN:-missing}"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/cgroup" "$TMP/cg" /hidden
t 'hidden ancestry is unsupported' 0 "${BUILD_MEMORY_KNOWN:-missing}"
printf '2:memory:/team\n' >"$TMP/v1"
read_host_memory "$TMP/meminfo"
read_cgroup_limits "$TMP/v1" "$TMP/cg" /
t 'v1 accounting is not guessed' 0 "${BUILD_MEMORY_KNOWN:-missing}"

# Isolate OS readings, not the admission decision. The marker is the observable
# privileged side effect; these tests cannot touch real swap, even when run as root.
policy_case() (
  local ram=$1 swap=$2 known=$3 restricted=$4 policy=$5
  OPT_SWAP=$policy
  read_build_memory() {
    BUILD_MEM_MB=$ram BUILD_AVAIL_MB=512 BUILD_SWAP_FREE_MB=$swap
    BUILD_MEMORY_KNOWN=$known BUILD_MEMORY_RESTRICTED=$restricted
    if [[ -f $TMP/created ]]; then BUILD_SWAP_FREE_MB=2048; fi
  }
  create_build_swap() { : >"$TMP/created"; }
  prepare_build_memory
)
policy_case 956 0 1 0 off >"$TMP/output" 2>&1
t 'low RAM without swap fails before building' 1 "$?"
t 'default failure creates no swap' no "$([[ -e $TMP/created ]] && printf yes || printf no)"
policy_case 956 1024 1 0 off >"$TMP/output" 2>&1
t 'existing usable swap permits low-memory build' 0 "$?"
t 'adequate swap causes no mutation' no "$([[ -e $TMP/created ]] && printf yes || printf no)"
policy_case 956 0 1 0 auto >"$TMP/output" 2>&1
t 'explicit opt-in prepares low-memory build' 0 "$?"
t 'explicit opt-in creates needed swap' yes "$([[ -e $TMP/created ]] && printf yes || printf no)"
rm -f "$TMP/created"
policy_case 956 0 1 1 auto >"$TMP/output" 2>&1
t 'finite cgroup cannot create host swap' 1 "$?"
t 'restricted failure creates no swap' no "$([[ -e $TMP/created ]] && printf yes || printf no)"
policy_case 956 2048 0 1 auto >"$TMP/output" 2>&1
t 'unknown accounting fails conservatively' 1 "$?"
policy_case 4096 0 1 0 auto >"$TMP/output" 2>&1
t 'adequate RAM needs no swap' 0 "$?"
t 'adequate RAM causes no mutation' no "$([[ -e $TMP/created ]] && printf yes || printf no)"
policy_case 956 2048 1 1 auto >"$TMP/output" 2>&1
t 'limited cgroup can use existing allowed swap' 0 "$?"
t 'existing allowed swap causes no mutation' no "$([[ -e $TMP/created ]] && printf yes || printf no)"

# A failure at admission must precede npm, chown and build-home writes.
(
  prepare_build_memory() { return 42; }
  pick_build_user() { : >"$TMP/unexpected"; }
  run_as_build_user() { return 23; }
  mkdir -p "$TMP/project"
  printf '{}\n' >"$TMP/project/package.json"
  build_project "$TMP/project"
) >"$TMP/output" 2>&1
t 'memory admission failure is propagated' 42 "$?"
t 'memory rejection precedes build side effects' no "$([[ -e $TMP/unexpected || -e $TMP/project/.build-home ]] && printf yes || printf no)"

# Prebuilt validation and an actual release rollback never inspect build memory.
mkdir -p "$TMP/prebuilt/assets"
printf '<div id="root"></div><script src="/assets/app.js"></script>\n' >"$TMP/prebuilt/index.html"
printf '{}\n' >"$TMP/prebuilt/manifest.webmanifest"
printf 'self.precacheAndRoute([])\n' >"$TMP/prebuilt/sw.js"
printf 'app\n' >"$TMP/prebuilt/assets/app.js"
(
  # shellcheck disable=SC2317  # tripwire: this operation must not call it
  read_build_memory() { : >"$TMP/unexpected-memory"; return 99; }
  # shellcheck disable=SC2317  # tripwire: this operation must not call it
  create_build_swap() { : >"$TMP/unexpected-memory"; return 99; }
  OPT_SOURCE=prebuilt OPT_DIST="$TMP/prebuilt" OPT_SWAP=auto
  fetch_and_build
) >"$TMP/output" 2>&1
t 'prebuilt validates without memory preparation' 0 "$?"
t 'prebuilt performs no swap-related work' no "$([[ -e $TMP/unexpected-memory ]] && printf yes || printf no)"
(
  # shellcheck disable=SC2317  # tripwire: this operation must not call it
  read_build_memory() { : >"$TMP/unexpected-memory"; return 99; }
  # shellcheck disable=SC2317  # tripwire: this operation must not call it
  create_build_swap() { : >"$TMP/unexpected-memory"; return 99; }
  OPT_WEBROOT="$TMP/rollback" OPT_SWAP=auto
  init_paths
  mkdir -p "$RELEASES_DIR/old" "$RELEASES_DIR/new"
  atomic_swap "$RELEASES_DIR/new"
  printf '%s\n' "$RELEASES_DIR/old" >"$PREVIOUS_MARK"
  run_rollback
  [[ $(current_release) == "$RELEASES_DIR/old" ]]
) >"$TMP/output" 2>&1
t 'rollback restores release without memory preparation' 0 "$?"
t 'rollback performs no swap-related work' no "$([[ -e $TMP/unexpected-memory ]] && printf yes || printf no)"

# Existing retained paths must never be reused, even with explicit consent.
mkdir -p "$TMP/retained"
printf 'keep me\n' >"$TMP/retained/swapfile"
(create_build_swap "$TMP/retained") >"$TMP/output" 2>&1
t 'existing swap directory rejected' 1 "$?"
t 'existing content untouched' 'keep me' "$(<"$TMP/retained/swapfile")"
ln -s "$TMP/retained" "$TMP/link"
(create_build_swap "$TMP/link") >"$TMP/output" 2>&1
t 'symlink swap directory rejected' 1 "$?"
t 'symlink destination untouched' 'keep me' "$(<"$TMP/retained/swapfile")"

# Inside the swap subshell a failure can only end that subshell. It must name
# the cause without claiming the whole install stopped, because the frame that
# can actually stop it is the one that prints the banner.
(create_build_swap "$TMP/retained") >"$TMP/output" 2>&1
t 'subshell failure names the cause' yes "$(grep -q 'Swap path already exists' "$TMP/output" && printf yes || printf no)"
t 'subshell failure does not claim a stopped install' no "$(grep -q 'Installation stopped' "$TMP/output" && printf yes || printf no)"

# Stub the kernel/privileged boundaries only. Directory/file creation and
# identity-checked cleanup still run against real temporary files.
swap_creation_case() (
  local outcome=$1 path=$2
  trusted_swap_parent() { return 0; }
  findmnt() { if [[ $outcome == filesystem ]]; then printf 'btrfs\n'; else printf 'ext4\n'; fi; }
  df() {
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
    if [[ $outcome == disk ]]; then printf 'test 9000000 8000000 1000000 90%% /\n'; else printf 'test 9000000 0 9000000 0%% /\n'; fi
  }
  stat() {
    if [[ $1 == -c && $2 == '%u:%a:%h' ]]; then printf '0:600:1\n'; else command stat "$@"; fi
  }
  dd() {
    local arg output=''
    for arg in "$@"; do case $arg in of=*) output=${arg#of=} ;; esac; done
    command dd if=/dev/zero of="$output" bs=1 count=64 conv=excl 2>/dev/null || return $?
    if [[ $outcome == allocation ]]; then return 42; fi
  }
  # shellcheck disable=SC2317  # dispatched via run_logged
  mkswap() { [[ $outcome != mkswap ]]; }
  # shellcheck disable=SC2317  # dispatched via run_logged
  swapon() { [[ $outcome != swapon ]] || return 1; : >"$TMP/active"; }
  swap_file_active() { [[ -e $TMP/active ]]; }
  create_build_swap "$path"
)
for failure in filesystem disk allocation mkswap swapon; do
  swap_creation_case "$failure" "$TMP/new-$failure" >"$TMP/output" 2>&1
  t "swap: $failure failure stops preparation" 1 "$?"
  t "swap: $failure removes only its new inactive directory" no "$([[ -e $TMP/new-$failure ]] && printf yes || printf no)"
  t "swap: $failure preserves unrelated retained file" 'keep me' "$(<"$TMP/retained/swapfile")"
done
swap_creation_case success "$TMP/new-success" >"$TMP/output" 2>&1
t 'swap: activation succeeds' 0 "$?"
t 'swap: activated file remains' yes "$([[ -f $TMP/new-success/swapfile ]] && printf yes || printf no)"
t 'swap: retention is disclosed' yes "$(grep -q 'remains active after success or failure' "$TMP/output" && printf yes || printf no)"
rm -f "$TMP/active"

# The caller invokes this helper through `helper || { ... }`, which suspends
# errexit for the whole call. Every privileged step is then on its own: a
# failure that nobody checks would carry on and, worst of all, leave the
# cleanup with an empty identity for the directory it is allowed to delete.
swap_identity_case() (
  local killed=$1
  trusted_swap_parent() { return 0; }
  findmnt() { printf 'ext4\n'; }
  df() { printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\ntest 9000000 0 9000000 0%% /\n'; }
  stat() {
    if [[ $1 == -c && $2 == '%d:%i' && $killed == yes ]]; then return 1; fi
    if [[ $1 == -c && $2 == '%u:%a:%h' ]]; then printf '0:600:1\n'; else command stat "$@"; fi
  }
  # Succeeds, so nothing downstream can stop the helper on its own: only the
  # missing identity check decides whether it carries on to activation.
  dd() {
    local arg output=''
    for arg in "$@"; do case $arg in of=*) output=${arg#of=} ;; esac; done
    command dd if=/dev/zero of="$output" bs=1 count=64 conv=excl 2>/dev/null || return $?
  }
  # shellcheck disable=SC2317  # dispatched via run_logged
  mkswap() { return 0; }
  # shellcheck disable=SC2317  # dispatched via run_logged
  swapon() { return 0; }
  swap_file_active() { return 0; }
  # Called the way production calls it: an OR-list suspends errexit for the
  # whole call, so only the helper's own checks can catch a failure.
  local status=0
  create_build_swap "$TMP/identity-$killed" || status=$?
  return "$status"
)
swap_identity_case yes >"$TMP/output" 2>&1
t 'swap: unverifiable directory identity stops the helper' 1 "$?"
t 'swap: unverifiable identity never reaches activation' no "$(grep -q 'Runtime swap active' "$TMP/output" && printf yes || printf no)"
t 'swap: unverifiable identity is named as the cause' yes "$(grep -qi 'identity\|Could not read' "$TMP/output" && printf yes || printf no)"
rm -rf "$TMP/identity-yes"

# Failure diagnostics and the top-level error trap preserve the observed status.
(
  read_build_memory() { :; }
  memory_snapshot() { :; }
  run_as_build_user() { return 137; }
  run_build_phase "$TMP" 'Test build' false
) >"$TMP/output" 2>&1
t 'diagnostics preserve observed build status' 137 "$?"
t 'SIGKILL is not labelled confirmed OOM' yes "$(grep -q 'not proof of OOM' "$TMP/output" && printf yes || printf no)"
# The rule the termination path exists for: the status is preserved, exactly one
# banner is printed, and the failing command is named once — whoever reported it.
# A failure inside a subshell is included: there it must end the process rather
# than be swallowed, because a command substitution that dies can otherwise leave
# the assignment with a plausible value and the install running on as if nothing
# had happened.
error_case() (
  local name=$1 expected=$2 cause=$3
  shift 3
  bash -c "$1" bash "$SCRIPT_DIR/install.sh" "$TMP" >"$TMP/output" 2>&1
  t "$name: keeps the status" "$expected" "$?"
  t "$name: prints exactly one stopped banner" 1 "$(grep -c 'Installation stopped' "$TMP/output" || true)"
  t "$name: names the cause exactly once" 1 "$(grep -ci "$cause" "$TMP/output" || true)"
)

# shellcheck disable=SC2016  # these strings are the test script's own source
error_case 'subshell failure' 7 'test cause' 'set -Eeuo pipefail
. "$1"
trap "on_error \"\$?\" \"\$LINENO\" \"\$BASH_COMMAND\"" ERR
helper() (die "test cause" 7)
after() { : >"$2/ran-on"; }
helper || { status=$?; stop_install "$status"; }
after'
t 'subshell failure does not run the next step' no "$([[ -e $TMP/ran-on ]] && printf yes || printf no)"

# Nothing named the cause here but the trap itself, so the command it reports is
# the cause. What matters is that it is named once and the status is not lost.
# shellcheck disable=SC2016  # the string is the test script's own source
error_case 'command failure' 1 'false' 'set -Eeuo pipefail
. "$1"
trap "on_error \"\$?\" \"\$LINENO\" \"\$BASH_COMMAND\"" ERR
false'

# A command substitution that fails must not become a success: the subshell
# handler returning instead of exiting would let the assignment finish and the
# install carry on with a value nobody checked.
bash -c 'set -Eeuo pipefail
. "$1"
trap "on_error \"\$?\" \"\$LINENO\" \"\$BASH_COMMAND\"" ERR
probe() { false; printf "ok\n"; }
value=$(probe)
printf "ASSIGNMENT SUCCEEDED\n"' bash "$SCRIPT_DIR/install.sh" >"$TMP/output" 2>&1
t 'failed command substitution stays fatal' 1 "$?"
t 'failed command substitution is not masked into success' no "$(grep -q 'ASSIGNMENT SUCCEEDED' "$TMP/output" && printf yes || printf no)"
t 'failed command substitution prints one stopped banner' 1 "$(grep -c 'Installation stopped' "$TMP/output" || true)"

# Forwarding must not change what the user is told and must not lose the status.
mkdir -p "$TMP/fwd/releases/old" "$TMP/fwd/releases/new"
printf 'old\n' >"$TMP/fwd/releases/old/index.html"
printf 'new\n' >"$TMP/fwd/releases/new/index.html"
cat >"$TMP/forwarded.sh" <<EOF
set -Eeuo pipefail
. "$SCRIPT_DIR/install.sh"
trap 'on_error "\$?" "\$LINENO" "\$BASH_COMMAND"' ERR
OPT_WEBROOT="$TMP/fwd"
init_paths
atomic_swap "\$RELEASES_DIR/new"
printf '%s\n' "\$RELEASES_DIR/old" >"\$PREVIOUS_MARK"
SWAP_DONE=1
helper() (die "test cause" 7)
build() { helper || { status=\$?; stop_install "\$status"; }; }
image() { build || { status=\$?; stop_install "\$status"; }; }
image
EOF
bash "$TMP/forwarded.sh" >"$TMP/output" 2>&1
t 'forwarded failure keeps the status' 7 "$?"
t 'forwarded failure prints one stopped banner' 1 "$(grep -c 'Installation stopped' "$TMP/output" || true)"
t 'forwarded failure names the cause exactly once' 1 "$(grep -c 'test cause' "$TMP/output" || true)"
# A live release must never be left in place after a failure: whichever frame
# reports it, the previous release comes back before the install gives up.
# (ln -s emulation on Windows copies instead of linking, so this asserts on Linux.)
t 'forwarded failure rolls a live release back' "$TMP/fwd/releases/old" "$(readlink "$TMP/fwd/current")"
t 'forwarded failure did not name plumbing as the cause' 0 "$(grep -c 'BASH_COMMAND\|return \$?' "$TMP/output" || true)"

# End-to-end: the real chain must reach the user as one cause plus one banner.
mkdir -p "$TMP/e2e-swap"
cat >"$TMP/e2e.sh" <<EOF
set -Eeuo pipefail
. "$SCRIPT_DIR/install.sh"
trap 'on_error "\$?" "\$LINENO" "\$BASH_COMMAND"' ERR
inner() { create_build_swap "$TMP/e2e-swap" || { status=\$?; stop_install "\$status"; }; }
outer() { inner || { status=\$?; stop_install "\$status"; }; }
outer
EOF
bash "$TMP/e2e.sh" >"$TMP/output" 2>&1
t 'subshell failure reaches the top with its status' 1 "$?"
t 'end-to-end failure prints one stopped banner' 1 "$(grep -c 'Installation stopped' "$TMP/output" || true)"
t 'end-to-end failure names its cause once' 1 "$(grep -c 'Swap path already exists' "$TMP/output" || true)"

# Rollback is itself a privileged operation on a broken system, so it can fail.
# When it does, the user still has to be told the install stopped and still needs
# the original cause and status: the rollback's own status replaces neither.
cat >"$TMP/rb-fail.sh" <<EOF
set -Eeuo pipefail
. "$SCRIPT_DIR/install.sh"
trap 'on_error "\$?" "\$LINENO" "\$BASH_COMMAND"' ERR
SWAP_DONE=1
rollback_deploy() { die 'rollback could not restore the previous release' 9; }
die 'primary cause' 5
EOF
bash "$TMP/rb-fail.sh" >"$TMP/output" 2>&1
t 'failed rollback keeps the original status' 5 "$?"
t 'failed rollback prints one stopped banner' 1 "$(grep -c 'Installation stopped' "$TMP/output" || true)"
t 'failed rollback keeps the original cause' 1 "$(grep -c 'primary cause' "$TMP/output" || true)"

# A finished install whose health checks failed is not an aborted install: the
# summary prints the outcome and leaving the release live is the documented
# choice, so nothing may roll it back and nothing may claim the install stopped.
# Its status still reaches the caller, because a caller has to see it.
cat >"$TMP/main-status.sh" <<EOF
set -Eeuo pipefail
. "$SCRIPT_DIR/install.sh"
trap 'on_error "\$?" "\$LINENO" "\$BASH_COMMAND"' ERR
parse_args() { :; }
init_log() { :; }
need_root() { :; }
acquire_lock() { :; }
init_paths() { :; }
banner() { :; }
preflight() { :; }
collect_config() { :; }
save_config() { :; }
install_packages() { :; }
fetch_and_build() { :; }
deploy_files() { :; }
configure_nginx() { :; }
configure_firewall() { :; }
setup_tls() { :; }
health_check() { :; }
rollback_deploy() { : >"$TMP/rolled-back"; }
summary() { printf 'SUMMARY RAN\n'; return 1; }
SWAP_DONE=1
main
EOF
bash "$TMP/main-status.sh" >"$TMP/output" 2>&1
t 'completed install keeps its exit status' 1 "$?"
t 'completed install runs its summary' yes "$(grep -q 'SUMMARY RAN' "$TMP/output" && printf yes || printf no)"
t 'completed install is not reported as an abort' no "$(grep -q 'Installation stopped' "$TMP/output" && printf yes || printf no)"
t 'completed install is not rolled back by its own summary' no "$([[ -e $TMP/rolled-back ]] && printf yes || printf no)"

printf '\nMemory tests: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
