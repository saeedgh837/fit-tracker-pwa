#!/usr/bin/env bash
# Destructive paths are all real temporary fixtures; OS service boundaries are stubbed.
# The stubs and globals below only look unreachable or unused to ShellCheck: the
# production code calls them by name once sourced.
# shellcheck disable=SC2016,SC2034,SC2317
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/test-fixtures.sh disable=SC1090,SC1091
. "$SCRIPT_DIR/test-fixtures.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fixture_installer "$SCRIPT_DIR/install.sh" "$TMP/root" "$TMP/fixture.sh"
# shellcheck disable=SC1090,SC1091
. "$TMP/fixture.sh"
set +e
trap - ERR
PASS=0 FAIL=0
t() { if [[ $2 == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL: %s expected=%q actual=%q\n' "$1" "$2" "$3"; fi; }

# Removal paths must never turn an arbitrary setting into an rm -rf target.
mkdir -p "$TMP/root/site/releases/one" "$TMP/root/unrelated"
printf 'keep\n' >"$TMP/root/unrelated/precious"
(guard_removal_path /) >"$TMP/out" 2>&1
t 'root deletion refused' 1 "$?"
(guard_removal_path /etc) >"$TMP/out" 2>&1
t 'system directory deletion refused' 1 "$?"
(guard_removal_path "$TMP/root/site") >"$TMP/out" 2>&1
t 'dedicated application directory allowed' 0 "$?"
ln -s "$TMP/root/unrelated" "$TMP/root/redirect"
(guard_removal_path "$TMP/root/redirect/child") >"$TMP/out" 2>&1
t 'symlink ancestor refused' 1 "$?"
(guard_removal_path "$TMP/root/site/../unrelated") >"$TMP/out" 2>&1
t 'parent traversal refused' 1 "$?"

# Inventory data must never be evaluated as shell code.
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
(inventory_record tree "$TMP/root/site") >"$TMP/out" 2>&1
t 'owned directory can be recorded' 0 "$?"
(inventory_load) >"$TMP/out" 2>&1
t 'valid inventory can be parsed' 0 "$?"
cp "$CONF_DIR/owned.tsv" "$TMP/inventory.good"
printf 'file\t$(touch %s/EXECUTED)\tx\ty\n' "$TMP" >>"$CONF_DIR/owned.tsv"
(inventory_load) >"$TMP/out" 2>&1
t 'malicious inventory rejected' 1 "$?"
t 'inventory is data, never executed' no "$([[ -e $TMP/EXECUTED ]] && printf yes || printf no)"
cp "$TMP/inventory.good" "$CONF_DIR/owned.tsv"

# Branch selection is production main, not a duplicate of its if statement.
(
  parse_args --uninstall --dry-run
  NON_INTERACTIVE=1
  need_root() { :; }
  acquire_lock() { :; }
  preflight() { : >"$TMP/unexpected-preflight"; return 99; }
  read_build_memory() { : >"$TMP/unexpected-swap"; return 99; }
  main
) >"$TMP/out" 2>&1
t 'uninstall dry-run exits successfully' 0 "$?"
t 'uninstall skips install preflight' no "$([[ -e $TMP/unexpected-preflight ]] && printf yes || printf no)"
t 'uninstall never prepares swap' no "$([[ -e $TMP/unexpected-swap ]] && printf yes || printf no)"
t 'dry-run keeps site files' yes "$([[ -d $TMP/root/site ]] && printf yes || printf no)"

# Noninteractive removal has to opt in; --yes never adopts unproven resources.
(
  NON_INTERACTIVE=1 ASSUME_YES=0 DRY_RUN=0
  run_uninstall
) >"$TMP/out" 2>&1
t 'noninteractive removal without consent refused' 1 "$?"
t 'refusal preserves site' yes "$([[ -d $TMP/root/site ]] && printf yes || printf no)"

# Real owned release removal, preserving witnesses, keys, swap and local source.
printf 'private\n' >"$TMP/root/unrelated/key.pem"
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  nginx() { return 0; }
  systemctl() { [[ $1 != is-active ]]; }
  run_uninstall
) >"$TMP/out" 2>&1
t 'owned install can be uninstalled' 0 "$?"
t 'owned directory removed' no "$([[ -e $TMP/root/site ]] && printf yes || printf no)"
t 'unrelated files kept' keep "$(<"$TMP/root/unrelated/precious")"
t 'external key kept' private "$(<"$TMP/root/unrelated/key.pem")"
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  run_uninstall
) >"$TMP/out" 2>&1
t 'second uninstall is harmless' 0 "$?"

# Changed configuration is not owned byte-for-byte anymore: preserve and report.
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
printf 'managed\n' >"$NGINX_SITE"
(inventory_record file "$NGINX_SITE") >"$TMP/out" 2>&1
printf 'operator changed this\n' >>"$NGINX_SITE"
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  run_uninstall
) >"$TMP/out" 2>&1
t 'modified nginx config produces incomplete removal status' 1 "$?"
t 'modified nginx config is retained' yes "$([[ -e $NGINX_SITE ]] && printf yes || printf no)"

# Active nginx detach failure restores files before deleting any served content.
# Start a separate inventory after the deliberately modified-config case above.
rm -f "$CONF_DIR/owned.tsv" "$NGINX_SITE"
mkdir -p "$TMP/root/failing-site"
printf 'served\n' >"$TMP/root/failing-site/index.html"
printf 'managed\n' >"$NGINX_SITE"
(inventory_record tree "$TMP/root/failing-site"; inventory_record file "$NGINX_SITE") >"$TMP/out" 2>&1
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  nginx() { return 0; }
  systemctl() { [[ $1 != reload ]]; }
  run_uninstall
) >"$TMP/out" 2>&1
t 'failed nginx reload stops deletion' 1 "$?"
t 'failed reload restores managed site config' managed "$(<"$NGINX_SITE")"
t 'failed reload preserves served app' served "$(<"$TMP/root/failing-site/index.html")"

# A recorded intent cannot authorise deleting a still-served untracked directory.
rm -f "$CONF_DIR/owned.tsv" "$NGINX_SITE"
(inventory_record tree "$TMP/root/failing-site") >"$TMP/out" 2>&1
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  nginx() { if [[ $1 == -T ]]; then printf 'root %s;\n' "$TMP/root/failing-site"; fi; return 0; }
  systemctl() { [[ $1 != is-active ]]; }
  run_uninstall
) >"$TMP/out" 2>&1
t 'shared or untracked nginx reference stops directory deletion' 1 "$?"
t 'still-served directory is retained' yes "$([[ -f $TMP/root/failing-site/index.html ]] && printf yes || printf no)"

# A reload can return 0 while nginx keeps serving the old configuration. If the
# restore path trusts only the exit status it reports a clean rollback that never
# happened, leaving the enabled link still pointing at the quarantined site.
rm -f "$CONF_DIR/owned.tsv" "$NGINX_SITE" "$NGINX_LINK"
printf 'managed\n' >"$NGINX_SITE"
ln -s "$NGINX_SITE" "$NGINX_LINK"
(inventory_record tree "$TMP/root/failing-site"; inventory_record file "$NGINX_SITE") >"$TMP/out" 2>&1
link_before=$(readlink "$NGINX_LINK")
(
  NON_INTERACTIVE=1 ASSUME_YES=1 DRY_RUN=0
  nginx() { return 0; }
  systemctl() { return 0; }
  # The test shell itself is the "worker": it stays alive, so the drain loop
  # observes a worker that never exits, exactly like a reload that never took.
  pgrep() { printf '%s\n' "$$"; return 1; }
  sleep() { :; }
  run_uninstall
) >"$TMP/out" 2>&1
t 'unverified nginx recovery is reported as failure' 1 "$?"
t 'recovery warning is printed' yes "$(grep -q 'Recovery incomplete' "$TMP/out" && printf yes || printf no)"
t 'enabled link still points at the restored site' "$link_before" "$(readlink "$NGINX_LINK" 2>/dev/null)"
t 'served app is retained' served "$(<"$TMP/root/failing-site/index.html")"

# Unknown mount accounting cannot be silently treated as no nested mounts.
(
  findmnt() { return 2; }
  guard_removal_path "$TMP/root/failing-site"
) >"$TMP/out" 2>&1
t 'unknown mount boundaries fail closed' 1 "$?"

printf '\nUninstall tests: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
