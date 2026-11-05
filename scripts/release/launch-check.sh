#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/launch-check.sh <exported Ardia.app>"
app="${1:?$usage}"
. "$(dirname "$0")/lib.sh"

echo "==> Launch check"
check_data="$(mktemp -d "${TMPDIR:-/tmp}/ac-release.XXXXXX")"
launched="$("$root/scripts/agent/ac" launch "$app" --data "$check_data" --js none --no-wait)" || die "the app didn't start"
check_port="$(sed -n 's/^pid [0-9]* port \([0-9]*\) .*/\1/p' <<<"$launched")"
ubo_ok=0
node "$root/scripts/lib/ubo-ready.mjs" "$check_port" 90 && ubo_ok=1
sleep 5
"$root/scripts/agent/ac" quit "$check_data" >/dev/null || die "the app quit before the check ended"
codesign --verify --deep --strict "$app" || die "running the app changed its bundle"
[ "$ubo_ok" = 1 ] || die "uBlock Origin wasn't ready and blocking in the exported app (90 s)"
rm -rf "$check_data"
