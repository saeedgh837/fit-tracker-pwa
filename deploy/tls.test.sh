#!/usr/bin/env bash
# Real CLI/OpenSSL tests. Never modifies the system trust store or activates nginx.
# The single-quoted snippets passed to run_activation_case expand inside the new
# bash process, not here, so ShellCheck's SC2016 is expected there.
# shellcheck disable=SC2016
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/install.sh disable=SC1090,SC1091
. "$SCRIPT_DIR/install.sh"
set +e
trap - ERR
PASS=0 FAIL=0
t() { if [[ $2 == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL: %s expected=%q actual=%q\n' "$1" "$2" "$3"; fi; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Must infer manual, reject conflicts and preserve off across old/new aliases.
mode=$(parse_args --tls-cert /etc/ssl/fullchain.pem --tls-key /etc/ssl/key.pem; resolve_tls_options; printf '%s' "$OPT_TLS_MODE")
t 'paired files select manual mode' manual "$mode"
(parse_args --tls-cert /x; resolve_tls_options) >"$TMP/out" 2>&1
t 'missing key is rejected' 1 "$?"
(parse_args --tls-mode auto --tls-cert /x --tls-key /y; resolve_tls_options) >"$TMP/out" 2>&1
t 'explicit automatic mode conflicts with manual files' 1 "$?"
(parse_args --skip-tls --tls-mode manual --tls-cert /x --tls-key /y; resolve_tls_options) >"$TMP/out" 2>&1
t 'skip TLS conflicts with manual mode' 1 "$?"
mode=$(parse_args --skip-tls; resolve_tls_options; printf '%s' "$OPT_TLS_MODE")
t 'old skip TLS option still works' off "$mode"
mode=$(CFG_TLS_MODE=manual CFG_TLS_CERT=/x CFG_TLS_KEY=/y; resolve_tls_options; printf '%s:%s:%s' "$OPT_TLS_MODE" "$OPT_TLS_CERT" "$OPT_TLS_KEY")
t 'saved manual paths are retained' manual:/x:/y "$mode"
mode=$(CFG_TLS_MODE=manual CFG_TLS_CERT=/x CFG_TLS_KEY=/y; parse_args --tls-mode off; resolve_tls_options; printf '%s' "$OPT_TLS_MODE")
t 'explicit mode overrides saved selection' off "$mode"

# OpenSSL fixtures: temporary CA, leaf SANs, RSA and EC keys.
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/ca.key" -out "$TMP/ca.pem" -days 2 -subj /CN=Hamgam-Test-CA >"$TMP/openssl.log" 2>&1 || exit 1
printf 'subjectAltName=DNS:fit.example.com,DNS:extra.example.com\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' >"$TMP/ext"
for kind in rsa ec; do
  if [[ $kind == rsa ]]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP/$kind.key" >>"$TMP/openssl.log" 2>&1
  else
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$TMP/$kind.key" >>"$TMP/openssl.log" 2>&1
  fi
  openssl req -new -key "$TMP/$kind.key" -out "$TMP/$kind.csr" -subj /CN=fit.example.com >>"$TMP/openssl.log" 2>&1
  openssl x509 -req -in "$TMP/$kind.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" -CAcreateserial -out "$TMP/$kind.pem" -days 1 -extfile "$TMP/ext" >>"$TMP/openssl.log" 2>&1
  chmod 600 "$TMP/$kind.key"
done
cert_case() (
  # `${4:-...}` would treat an explicit empty fourth argument as unset, which
  # silently re-adds the extra host these cases need to leave out.
  OPT_DOMAIN=${3:-fit.example.com}
  if [[ $# -ge 4 ]]; then OPT_EXTRA_HOSTS=$4; else OPT_EXTRA_HOSTS=extra.example.com; fi
  OPT_TLS_MODE=manual OPT_TLS_CERT=$1 OPT_TLS_KEY=$2
  OPT_WEBROOT="$TMP/site" OPT_REPO_DIR="$TMP/clone"
  export SSL_CERT_FILE="$TMP/ca.pem"
  validate_manual_tls
)
# On Linux these run as root, as does the installer (permissions are real).
for kind in rsa ec; do
  cert_case "$TMP/$kind.pem" "$TMP/$kind.key" >"$TMP/out" 2>&1
  t "$kind certificate/key accepted" 0 "$?"
done
cert_case "$TMP/rsa.pem" "$TMP/ec.key" >"$TMP/out" 2>&1
t 'mismatched private key is rejected' 1 "$?"
cert_case "$TMP/rsa.pem" "$TMP/rsa.key" other.example.com >"$TMP/out" 2>&1
t 'wrong primary SAN rejected' 1 "$?"
cert_case "$TMP/rsa.pem" "$TMP/rsa.key" fit.example.com wrong.example.com >"$TMP/out" 2>&1
t 'wrong extra SAN rejected' 1 "$?"
cert_case "$TMP/missing.pem" "$TMP/rsa.key" >"$TMP/out" 2>&1
t 'missing certificate rejected' 1 "$?"
printf 'not a certificate\n' >"$TMP/bad.pem"
cert_case "$TMP/bad.pem" "$TMP/rsa.key" >"$TMP/out" 2>&1
t 'malformed PEM rejected' 1 "$?"
cert_case "$TMP/rsa.pem;bad" "$TMP/rsa.key" >"$TMP/out" 2>&1
t 'nginx metacharacters in path rejected' 1 "$?"
openssl pkey -in "$TMP/rsa.key" -aes-256-cbc -passout pass:test-only -out "$TMP/encrypted.key" >>"$TMP/openssl.log" 2>&1
cert_case "$TMP/rsa.pem" "$TMP/encrypted.key" >"$TMP/out" 2>&1
t 'encrypted key rejected without password prompt' 1 "$?"
chmod 644 "$TMP/rsa.key"
cert_case "$TMP/rsa.pem" "$TMP/rsa.key" >"$TMP/out" 2>&1
t 'world-readable key rejected' 1 "$?"
chmod 600 "$TMP/rsa.key"
mkdir "$TMP/site"
cp "$TMP/rsa.key" "$TMP/site/key.pem"
cert_case "$TMP/rsa.pem" "$TMP/site/key.pem" >"$TMP/out" 2>&1
t 'private key in served directory rejected' 1 "$?"
# Modern browsers ignore CN and require a DNS SAN. OpenSSL on its own still
# falls back to CN, so the check has to be explicit or a CN-only certificate
# passes here and fails in every browser.
openssl req -new -key "$TMP/rsa.key" -out "$TMP/cn.csr" -subj /CN=fit.example.com >"$TMP/openssl.log" 2>&1
openssl x509 -req -in "$TMP/cn.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" -CAcreateserial \
  -out "$TMP/cn-only.pem" -days 1 >>"$TMP/openssl.log" 2>&1
# OpenSSL falls back to CN when there is no SAN, so pass no extra hosts here:
# with one present the case would pass for the wrong reason.
cert_case "$TMP/cn-only.pem" "$TMP/rsa.key" fit.example.com '' >"$TMP/out" 2>&1
t 'certificate with no SAN rejected' 1 "$?"
# One SAN covered but not the other: the hostname check alone would pass.
printf 'subjectAltName=DNS:fit.example.com\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' >"$TMP/ext-one"
openssl x509 -req -in "$TMP/rsa.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" -CAcreateserial \
  -out "$TMP/one-san.pem" -days 1 -extfile "$TMP/ext-one" >>"$TMP/openssl.log" 2>&1
cert_case "$TMP/one-san.pem" "$TMP/rsa.key" fit.example.com extra.example.com >"$TMP/out" 2>&1
t 'extra host missing from SAN rejected' 1 "$?"
# Trust must not be disabled just because the operator selected manual mode.
( unset SSL_CERT_FILE; OPT_DOMAIN=fit.example.com OPT_EXTRA_HOSTS=''; OPT_TLS_CERT="$TMP/rsa.pem" OPT_TLS_KEY="$TMP/rsa.key"; validate_manual_tls ) >"$TMP/out" 2>&1
t 'untrusted certificate rejected' 1 "$?"

# Actual generated configuration, not a duplicate heredoc in the test.
(
  OPT_DOMAIN=fit.example.com OPT_EXTRA_HOSTS=extra.example.com
  OPT_TLS_MODE=manual OPT_TLS_CERT=/etc/ssl/fullchain.pem OPT_TLS_KEY=/etc/ssl/key.pem
  CURRENT_LINK=/var/www/hamgam/current
  render_site_config
) >"$TMP/config" 2>"$TMP/out"
t 'manual configuration is generated successfully' 0 "$?"
t 'HTTPS listener is rendered' yes "$(grep -q 'listen 443 ssl;' "$TMP/config" && printf yes || printf no)"
t 'certificate path is rendered' yes "$(grep -q 'ssl_certificate "/etc/ssl/fullchain.pem";' "$TMP/config" && printf yes || printf no)"
t 'HTTP redirects to the requested hostname' yes "$(grep -q 'https://fit.example.com' "$TMP/config" && printf yes || printf no)"
t 'cache map and headers remain present' yes "$(grep -q 'Cache-Control' "$TMP/config" && grep -q 'hamgam-headers' "$TMP/config" && printf yes || printf no)"

# Only external system commands are replaced: file replacement/restoration is real.
# Every case runs in a fresh bash process. This file already sourced install.sh,
# and its constants are readonly; re-sourcing the fixture in the same shell would
# abort the body and the failure assertions would pass without running anything.
# shellcheck source=deploy/test-fixtures.sh disable=SC1090,SC1091
. "$SCRIPT_DIR/test-fixtures.sh"
fixture_installer "$SCRIPT_DIR/install.sh" "$TMP/root" "$TMP/fixture.sh"
run_activation_case() (
  local script=$1
  mkdir -p "$TMP/root/etc/nginx/sites-available"
  printf '# previous configuration\n' >"$TMP/root/etc/nginx/sites-available/hamgam"
  bash -c "$script" _ "$TMP/fixture.sh" "$TMP/root" >"$TMP/out" 2>&1
)

for failure in test reload; do
  export MODE=$failure
  run_activation_case '
    set +e
    trap - ERR
    . "$1"
    OPT_DOMAIN=fit.example.com OPT_WEBROOT="$2/site"
    OPT_TLS_MODE=manual OPT_TLS_CERT=/etc/ssl/fullchain.pem OPT_TLS_KEY=/etc/ssl/key.pem
    # No workers: the drain must not be what makes this case fail.
    pgrep() { return 1; }
    nginx() { [ "$MODE" = test ] && return 1; return 0; }
    systemctl() { [ "$1" = reload ] && [ "$MODE" = reload ] && return 1; return 0; }
    activate_site_config
  '
  t "nginx $failure failure is fatal" 1 "$?"
  t "nginx $failure failure restores previous file" '# previous configuration' "$(<"$TMP/root/etc/nginx/sites-available/hamgam")"
done
unset MODE

# reload returns 0 even when the master cannot bind a listener (port in use) and
# therefore keeps the old configuration. The transaction must notice that the
# previous workers never went away and roll back instead of reporting success.
run_activation_case '
  set +e
  trap - ERR
  . "$1"
  OPT_DOMAIN=fit.example.com OPT_WEBROOT="$2/site"
  OPT_TLS_MODE=manual OPT_TLS_CERT=/etc/ssl/fullchain.pem OPT_TLS_KEY=/etc/ssl/key.pem
  nginx() { return 0; }
  systemctl() { return 0; }
  # The test shell is the "worker": it stays alive, so the drain observes a
  # worker that never exits, like a reload that was accepted but never applied.
  # A fake PID would fail kill -0 at once and look like a successful drain.
  pgrep() { printf "%s\n" "$$"; return 1; }
  sleep() { :; }
  activate_site_config
'
t 'a reload that keeps the old workers is fatal' 1 "$?"
# The status alone is not enough: the same subcommand can fail for other reasons.
# Only this message proves the drain branch detected the unapplied configuration.
t 'the cause names the workers that never exited' yes "$(grep -q 'kept the previous workers' "$TMP/out" && printf yes || printf no)"
t 'unapplied reload restores previous file' '# previous configuration' "$(<"$TMP/root/etc/nginx/sites-available/hamgam")"

printf '\nTLS tests: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
