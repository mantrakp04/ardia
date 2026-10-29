#!/usr/bin/env bash
set -euo pipefail

old="${1:?usage: update-test.sh <previous app> <new app> <appcast.xml> <version>}"
new="${2:?}" appcast="${3:?}" version="${4:?}"
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib/harness.sh"
test_id="com.ardia.browser.updatetest"
new_test_id="$test_id"
[ "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$old/Contents/Info.plist")" = \
  "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$new/Contents/Info.plist")" ] || new_test_id="$test_id.renamed"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/ac-update-test.XXXXXX")" && pwd -P)"
server=""
cleanup() {
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  for id in "$test_id" "$new_test_id"; do
    defaults delete "$id" >/dev/null 2>&1 || true
    rm -f "$HOME/Library/Preferences/$id.plist"
  done
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "FAIL  Sparkle updates the previous build in place  ($*)"; exit 1; }
plist() { /usr/libexec/PlistBuddy "$@"; }

public_key="$(test_signing_key "$work")"
identity="$(signing_identity)"
installed_name="$(basename "$old")"
zip_name="$("$harness_root/scripts/lib/legacy-name.sh" appFileName)"
mkdir -p "$work/installed" "$work/new" "$work/feed" "$work/home"
ditto "$old" "$work/installed/$installed_name"
ditto "$new" "$work/new/$zip_name"
retag "$work/installed/$installed_name" "$test_id" "$public_key" "$identity"
retag "$work/new/$zip_name" "$new_test_id" "$public_key" "$identity"
build_sparkle_tool "$work" "$old" sparkle-host "$identity"
serve_dir "$work/feed"
port="$served_port"

zip="$work/feed/Ardia-$version.zip"
ditto -c -k --keepParent "$work/new/$zip_name" "$zip"
signature="$("$work/ed25519" sign "$zip" "$work/key")"
python3 -I "$here/appcast.py" retarget "$appcast" "$version" "http://127.0.0.1:$port/$(basename "$zip")" "$(stat -f %z "$zip")" "$signature" \
  > "$work/feed/appcast.xml"
installed="$work/installed/$installed_name"
from="$(plist -c "Print :CFBundleShortVersionString" "$installed/Contents/Info.plist")"
channel="$(sed -n 's/.*<sparkle:channel>\([^<]*\)<.*/\1/p' "$work/feed/appcast.xml" | head -1)"
if [ -n "$channel" ]; then
  HOME="$work/home" CFFIXED_USER_HOME="$work/home" timeout 300 "$work/sparkle-host" "$installed" \
    "http://127.0.0.1:$port/appcast.xml" none > "$work/sparkle-default.log" 2>&1 \
    || { sed 's/^/      /' "$work/sparkle-default.log"; echo "FAIL  a copy of $from on the stable channel ignores $version ($channel)"; exit 1; }
  sed 's/^/      /' "$work/sparkle-default.log"
  echo "PASS  a copy of $from on the stable channel ignores $version ($channel)"
fi
HOME="$work/home" CFFIXED_USER_HOME="$work/home" timeout 300 "$work/sparkle-host" "$installed" \
  "http://127.0.0.1:$port/appcast.xml" "$version" $channel > "$work/sparkle.log" 2>&1 \
  || { sed 's/^/      /' "$work/sparkle.log"; fail "Sparkle didn't install it"; }
sed 's/^/      /' "$work/sparkle.log"
codesign --verify --deep --strict "$installed" 2>/dev/null || fail "the installed bundle isn't sealed"
mtree -c -k type,mode,link,size,sha256digest -p "$work/new/$zip_name" > "$work/new.mtree"
differences="$(mtree -p "$installed" -f "$work/new.mtree" 2>&1 | head -5 || true)"
[ -z "$differences" ] || fail "the installed bundle differs from the new build: $differences"
ls "$work/installed" | grep -qvxF "$installed_name" && fail "left beside it: $(ls "$work/installed" | tr '\n' ' ')"
renamed=""
[ "$new_test_id" = "$test_id" ] || renamed="; across the bundle id change, on the EdDSA signature"
echo "PASS  Sparkle on $from${channel:+ on the $channel channel} updates a copy in place to $version (feed, EdDSA, extraction, installer; the bundle is the new build's, sealed$renamed)"
