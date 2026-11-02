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
enclosure="$(python3 -I "$root/.claude/skills/release/scripts/appcast.py" enclosure "$feed" "$version")" \
  || { echo "::error::$feed has no single item for $version"; exit 1; }
read -r signature length <<<"$enclosure"
key="$(plutil -extract SUPublicEDKey raw "$dist/export/Ardia.app/Contents/Info.plist")"
[ "$length" = "$(stat -f %z "$zip")" ] || { echo "::error::the appcast's length for $(basename "$zip") is $length, the file is $(stat -f %z "$zip")"; exit 1; }
"$work/ed25519" verify "$zip" "$signature" "$key" \
  || { echo "::error::$(basename "$zip")'s EdDSA signature doesn't verify with the app's SUPublicEDKey: SPARKLE_ED_PRIVATE_KEY is the wrong key"; exit 1; }
echo "PASS  $(basename "$zip") is signed with the key in SUPublicEDKey ($key)"
