#!/usr/bin/env bash
set -euo pipefail

usage="usage: verify-feed.sh [--signed] <appcast.xml or URL> [public key]"
required=0
[ "${1:-}" = --signed ] && { required=1; shift; }
feed="${1:?$usage}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
key="${2:-$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$root/apps/browser/macos/Ardia-macOS/Info.plist")}"
work="$(mktemp -d "${TMPDIR:-/tmp}/ac-verify-feed.XXXXXX")"
trap 'rm -rf "$work"' EXIT
case "$feed" in
  http://* | https://*) curl -fsSL --max-time 30 --retry 2 "$feed" -o "$work/appcast.xml" ;;
  *) cp "$feed" "$work/appcast.xml" ;;
esac
signature="$(python3 -I - "$work/appcast.xml" "$work/signed" "$feed" <<'PY'
import re, sys
path, signed, source = sys.argv[1:]
data = open(path, "rb").read()
start = data.rfind(b"<!-- sparkle-signatures:")
if start < 0:
    sys.exit(0)
block = data[start:].decode("utf-8", "replace")
signature = re.search(r"^edSignature: (\S+)$", block, re.M)
length = re.search(r"^length: (\d+)$", block, re.M)
if not signature or not length or not block.rstrip().endswith("-->"):
    sys.exit(f"error: {source}'s signature block is malformed")
if int(length.group(1)) != start:
    sys.exit(f"error: {source}'s signature covers {length.group(1)} bytes, but {start} come before it")
open(signed, "wb").write(data[:start])
print(signature.group(1))
PY
)"
if [ -z "$signature" ]; then
  if [ "$required" = 0 ] && [ "${ALLOW_UNSIGNED_FEED:-0}" = 1 ]; then
    echo "warning: $feed has no Sparkle signature; accepted because ALLOW_UNSIGNED_FEED=1" >&2
    exit 0
  fi
  hint=""
  [ "$required" = 1 ] || hint="; only the first release that signs the feed builds on an unsigned one, with ALLOW_UNSIGNED_FEED=1"
  echo "FAIL  $feed isn't signed  (it has no Sparkle signature$hint)"
  exit 1
fi
swiftc -O "$here/ed25519.swift" -o "$work/ed25519" 2>/dev/null
"$work/ed25519" verify "$work/signed" "$signature" "$key" \
  || { echo "FAIL  $feed's Sparkle signature doesn't verify with $key"; exit 1; }
echo "PASS  $feed's Sparkle signature verifies with $key"
