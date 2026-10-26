#!/usr/bin/env bash
# Checks that a release's appcast item signs its zip with the key the app trusts (SUPublicEDKey), so a Sparkle key
# from the CI secret that doesn't match the app fails here instead of on every update.
#
#   .github/release/check-sparkle.sh <dist dir> <version>
set -euo pipefail

dist="${1:?usage: check-sparkle.sh <dist> <version>}"
version="${2:?usage: check-sparkle.sh <dist> <version>}"
feed="$dist/appcast.xml"
zip="$dist/Ardia-$version.zip"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
work="$(mktemp -d "${TMPDIR:-/tmp}/ac-sparkle.XXXXXX")"
trap 'rm -rf "$work"' EXIT

swiftc -O "$root/.claude/skills/release/scripts/ed25519.swift" -o "$work/ed25519"
item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$feed")"
[ -n "$item" ] || { echo "::error::$feed has no item for $version"; exit 1; }
signature="$(grep -o 'sparkle:edSignature="[^"]*"' <<<"$item" | head -1 | sed 's/^sparkle:edSignature="//; s/"$//')"
length="$(grep -o 'length="[0-9]*"' <<<"$item" | head -1 | tr -dc '0-9')"
key="$(plutil -extract SUPublicEDKey raw "$dist/export/Ardia.app/Contents/Info.plist")"
[ "$length" = "$(stat -f %z "$zip")" ] || { echo "::error::the appcast's length for $(basename "$zip") is $length, the file is $(stat -f %z "$zip")"; exit 1; }
"$work/ed25519" verify "$zip" "$signature" "$key" \
  || { echo "::error::$(basename "$zip")'s EdDSA signature doesn't verify with the app's SUPublicEDKey: SPARKLE_ED_PRIVATE_KEY is the wrong key"; exit 1; }
echo "PASS  $(basename "$zip") is signed with the key in SUPublicEDKey ($key)"
