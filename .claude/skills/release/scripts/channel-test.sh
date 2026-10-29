#!/usr/bin/env bash
set -euo pipefail

old="${1:?usage: channel-test.sh <installed app> [new app]}"
new="${2:-$old}"
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib/harness.sh"
test_id="com.ardia.browser.channeltest"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/ac-channel-test.XXXXXX")" && pwd -P)"
server=""
status=0
cleanup() {
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  defaults delete "$test_id" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/Preferences/$test_id.plist"
  rm -rf "$work"
}
trap cleanup EXIT
check() {
  if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1"; status=1; fi
}
plist() { /usr/libexec/PlistBuddy "$@"; }
info() { plist -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }

pods="$harness_root/apps/browser/macos/Pods/Sparkle"
public_key="$(test_signing_key "$work")"
identity="$(signing_identity)"
build_sparkle_tool "$work" "$old" sparkle-host "$identity"
build_sparkle_tool "$work" "$old" version-order "$identity"
mkdir -p "$work/feeds"
serve_dir "$work/feeds"
port="$served_port"

from="$(info "$old" CFBundleShortVersionString)" build="$(info "$old" CFBundleVersion)"
case "$from" in *-nightly.*) echo "error: start from a stable build ($old is $from)" >&2; exit 1 ;; esac
next="$(awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 1 }' <<<"$from")"
after="$(awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 2 }' <<<"$from")"
nightly1="$next-nightly.1" stable="$next" nightly2="$after-nightly.1"

"$work/version-order" "$from=$build" "$nightly1=$((build + 1))" "$next-nightly.2=$((build + 2))" "$stable=$((build + 3))" \
  "$nightly2=$((build + 4))" > "$work/order.log" && ok=1 || ok=0
cat "$work/order.log"
check "Sparkle's comparator orders the builds $from < $nightly1 < $next-nightly.2 < $stable < $nightly2" $ok
"$work/version-order" "$nightly1=$nightly1" "$next-nightly.2=$next-nightly.2" >/dev/null 2>&1 && ok=0 || ok=1
check "the short versions alone don't order nightlies ($nightly1 vs $next-nightly.2), so sparkle:version stays the build number" $ok

zip_name="$("$harness_root/scripts/lib/legacy-name.sh" appFileName)"
installed_name="$(basename "$old")"
mkdir -p "$work/installed" "$work/home"
ditto "$old" "$work/installed/$installed_name"
retag "$work/installed/$installed_name" "$test_id" "$public_key" "$identity"

candidate() {
  local short="$1" number="$2" channel="$3" dir="$work/candidates/$1"
  mkdir -p "$dir"
  ditto "$new" "$dir/$zip_name"
  local info_plist="$dir/$zip_name/Contents/Info.plist"
  plist -c "Set :CFBundleIdentifier $test_id" -c "Set :SUPublicEDKey $public_key" \
    -c "Set :CFBundleShortVersionString $short" -c "Set :CFBundleVersion $number" "$info_plist"
  plist -c "Delete :ACUpdateChannel" "$info_plist" >/dev/null 2>&1 || true
  [ "$channel" = stable ] || plist -c "Add :ACUpdateChannel string $channel" "$info_plist"
  codesign --force --deep --timestamp=none --sign "$identity" "$dir/$zip_name" 2>/dev/null
  (cd "$dir" && ditto -c -k --keepParent "$zip_name" "$work/candidates/Ardia-$short.zip")
  rm -rf "$dir"
}
candidate "$nightly1" $((build + 1)) nightly
candidate "$stable" $((build + 3)) stable
candidate "$nightly2" $((build + 4)) nightly

publish() {
  local feed="$work/feeds/$1" short channel_args
  shift
  mkdir -p "$feed/archives"
  for short in "$@"; do
    channel_args=()
    case "$short" in *-nightly.*) channel_args=(--channel nightly) ;; esac
    cp -c "$work/candidates/Ardia-$short.zip" "$feed/archives/"
    "$pods/bin/generate_appcast" --ed-key-file "$work/key" ${channel_args[@]+"${channel_args[@]}"} \
      --download-url-prefix "http://127.0.0.1:$port/$(basename "$feed")/" "$feed/archives" > "$feed/generate.log" 2>&1 \
      || { cat "$feed/generate.log" >&2; exit 1; }
    mv "$feed/archives/Ardia-$short.zip" "$feed/"
    rm -rf "$feed/archives/old_updates"
  done
  mv "$feed/archives/appcast.xml" "$feed/appcast.xml"
  rm -rf "$feed/archives"
}
publish nightly-only "$nightly1"
publish nightly-then-stable "$nightly1" "$stable"
publish all "$nightly1" "$stable" "$nightly2"
grep -c '<sparkle:channel>nightly</sparkle:channel>' "$work/feeds/all/appcast.xml" | grep -qx 2 && ok=1 || ok=0
check "generate_appcast --channel nightly tags the nightly items and leaves the stable one untagged" $ok

scenario() {
  local what="$1" feed="$2" expected="$3" channels="${4:-}" copy="$work/run/$2-${4:-stable}"
  rm -rf "$copy" && mkdir -p "$copy"
  cp -cR "$work/installed/$installed_name" "$copy/"
  defaults delete "$test_id" >/dev/null 2>&1 || true
  if HOME="$work/home" CFFIXED_USER_HOME="$work/home" timeout 300 "$work/sparkle-host" "$copy/$installed_name" \
    "http://127.0.0.1:$port/$feed/appcast.xml" "$expected" $channels > "$copy.log" 2>&1; then
    if [ "$expected" = none ] || [ "$(info "$copy/$installed_name" CFBundleShortVersionString)" = "$expected" ]; then ok=1; else ok=0; fi
  else
    ok=0
  fi
  [ "$ok" = 1 ] || sed 's/^/      /' "$copy.log"
  check "$what" $ok
  rm -rf "$copy"
}
scenario "$from on stable (every shipped build) isn't offered $nightly1" nightly-only none
scenario "$from on nightly gets $nightly1" nightly-only "$nightly1" nightly
scenario "$from on nightly gets $stable when it's the newest" nightly-then-stable "$stable" nightly
scenario "$from on stable gets $stable and skips the newer $nightly2" all "$stable"
scenario "$from on nightly gets the newest of both, $nightly2" all "$nightly2" nightly
exit $status
