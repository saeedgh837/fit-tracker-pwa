#!/usr/bin/env bash
# Test utility: source production functions while redirecting fixed system paths
# into a temporary fixture. No test-only path override exists in the installer.
#
# Source the generated file from a *fresh* bash process. install.sh declares its
# constants readonly, and in a shell that has already sourced install.sh even a
# plain assignment to itself aborts with "readonly variable" — the test body
# would never run and a failure assertion would pass for free.
fixture_installer() {
  local script=$1 root=$2 output=$3
  mkdir -p "$root/etc/nginx/sites-available" "$root/etc/nginx/sites-enabled" "$root/etc/nginx/snippets" "$root/etc/nginx/conf.d" "$root/var/log/nginx" "$root/var/lib" "$root/run/lock"
  # Keep non-path single-quoted constants intact; only rewrite path declarations.
  sed -E "s|^readonly ([A-Z_]+)='/etc/([^']*)'|readonly \\1=\"$root/etc/\\2\"|; s|^readonly ([A-Z_]+)='/var/log/([^']*)'|readonly \\1=\"$root/var/log/\\2\"|; s|^readonly ([A-Z_]+)='/run/lock/([^']*)'|readonly \\1=\"$root/run/lock/\\2\"|" "$script" >"$output"
}
