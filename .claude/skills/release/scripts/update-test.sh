#!/usr/bin/env bash
set -euo pipefail

old="${1:?usage: update-test.sh <previous app> <new app> <appcast.xml> <version>}"
new="${2:?}" appcast="${3:?}" version="${4:?}"
here="$(cd "$(dirname "$0")" && pwd)"
test_id="com.ardia.browser.updatetest"
new_test_id="$test_id"
[ "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$old/Contents/Info.plist")" = \
  "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$new/Contents/Info.plist")" ] || new_test_id="$test_id.renamed"
port="${UPDATE_TEST_PORT:-8796}"
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

swiftc -O "$here/ed25519.swift" -o "$work/ed25519" 2>/dev/null
public_key="$("$work/ed25519" generate "$work/key")"
identity="$(security find-identity -v -p codesigning | awk '/"Apple Development/ { print $2; exit }')"
[ -n "$identity" ] || { echo "error: no Apple Development identity to sign the test copies with" >&2; exit 1; }
retag() {
  plist -c "Set :CFBundleIdentifier $2" -c "Set :SUPublicEDKey $public_key" "$1/Contents/Info.plist"
  codesign --force --deep --timestamp=none --sign "$identity" "$1" 2>/dev/null
}
installed_name="$(basename "$old")"
root="$(git -C "$here" rev-parse --show-toplevel)"
zip_name="$(sed -n 's/^ *public static let appFileName = "\(.*\)"$/\1/p' "$root/packages/sync/ios/Core/LegacyMigration.swift")"
[[ "$zip_name" == *.app ]] || { echo "error: can't read the legacy app name from LegacyMigration.swift" >&2; exit 1; }
mkdir -p "$work/installed" "$work/new" "$work/feed" "$work/home"
ditto "$old" "$work/installed/$installed_name"
ditto "$new" "$work/new/$zip_name"
retag "$work/installed/$installed_name" "$test_id"
retag "$work/new/$zip_name" "$new_test_id"
ditto "$old/Contents/Frameworks/Sparkle.framework" "$work/fw/Sparkle.framework"
pods="$root/apps/browser/macos/Pods/Sparkle"
swiftc -O "$here/sparkle-host.swift" -F "$pods" -framework Sparkle -Xlinker -rpath -Xlinker "$work/fw" \
  -o "$work/sparkle-host" 2>"$work/swiftc.log" || { cat "$work/swiftc.log" >&2; exit 1; }
codesign --force --timestamp=none --sign "$identity" "$work/sparkle-host" 2>/dev/null

zip="$work/feed/Ardia-$version.zip"
ditto -c -k --keepParent "$work/new/$zip_name" "$zip"
signature="$("$work/ed25519" sign "$zip" "$work/key")"
python3 - "$appcast" "$version" "http://127.0.0.1:$port/$(basename "$zip")" "$(stat -f %z "$zip")" "$signature" > "$work/feed/appcast.xml" <<'PY'
import re, sys
source, version, url, length, signature = sys.argv[1:]
xml = open(source).read()
items = [i for i in re.findall(r"<item>.*?</item>", xml, re.S) if f"<sparkle:shortVersionString>{version}<" in i]
if not items: sys.exit(f"no {version} item in {source}")
item = re.sub(r'url="[^"]*"', f'url="{url}"', items[0])
item = re.sub(r'length="[^"]*"', f'length="{length}"', item)
item = re.sub(r'sparkle:edSignature="[^"]*"', f'sparkle:edSignature="{signature}"', item)
item = re.sub(r"\s*<sparkle:phasedRolloutInterval>.*?</sparkle:phasedRolloutInterval>", "", item)
print(xml[: xml.index("<item>")] + item + "\n    </channel>\n</rss>")
PY
"$pods/bin/sign_update" --ed-key-file "$work/key" "$work/feed/appcast.xml" >/dev/null
if nc -z -G 2 127.0.0.1 "$port" 2>/dev/null; then
  echo "error: port $port is taken (UPDATE_TEST_PORT)" >&2
  exit 1
fi
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$work/feed" >/dev/null 2>&1 &
server=$!
sleep 1

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
