#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: smoke.sh <version> <previous-version> [--rc]}"
previous="${2:?usage: smoke.sh <version> <previous-version> [--rc]}"
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib/harness.sh"
root="$harness_root"
if [ "${3:-}" = --rc ]; then dist="$root/dist/$version-rc"; else dist="$root/dist/$version"; fi
app="${SMOKE_APP:-$dist/export/Ardia.app}"
old="$(ls -d "$root/dist/$previous/export"/*.app 2>/dev/null | head -1)"
old="${old:-$root/dist/$previous/export/Ardia.app}"
[ -d "$app" ] || { echo "error: no $app (run scripts/release.sh $version first)" >&2; exit 1; }
[ "$(cd "$app" && pwd -P)" != /Applications/Ardia.app ] || { echo "error: never the installed app (/Applications/Ardia.app)" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-smoke.XXXXXX")"
server=""
logger=""
cleanup() {
  [ -n "${pid:-}" ] && kill -KILL "$pid" 2>/dev/null || true
  [ -n "$logger" ] && { kill "$logger"; wait "$logger"; } 2>/dev/null || true
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

status=0
check() {
  if [ "$2" = 1 ]; then echo "PASS  $1${3:+  ($3)}"; else echo "FAIL  $1${3:+  ($3)}"; status=1; fi
}
info() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }
cdhash() { codesign -dvvv "$1" 2>&1 | sed -n 's/^CDHash=//p'; }

fw="$app/Contents/Frameworks"
[ -d "$fw/Chromium Framework.framework" ] && [ ! -e "$fw/Chromium Embedded Framework.framework" ] && ok=1 || ok=0
check "the engine is ArdiaCore (Chrome's framework, no CEF)" $ok \
  "$(plutil -extract CFBundleShortVersionString raw "$fw/Chromium Framework.framework/Resources/Info.plist" 2>/dev/null)"
if [ -d "$old" ]; then
  legacy_id="$("$root/scripts/lib/legacy-name.sh" bundleId)"
  old_id="$(info "$old" CFBundleIdentifier)" new_id="$(info "$app" CFBundleIdentifier)"
  renamed=0
  [ -n "$legacy_id" ] && [ "$old_id" = "$legacy_id" ] && [ "$new_id" != "$legacy_id" ] && renamed=1
  if [ "$renamed" = 1 ]; then
    echo "      renamed: $old_id → $new_id, $(info "$old" CFBundleExecutable) → $(info "$app" CFBundleExecutable)"
    keys="SUPublicEDKey" what="same update key as $previous (the rename keeps it)"
  else
    keys="CFBundleIdentifier CFBundleExecutable SUFeedURL SUPublicEDKey" what="same bundle id, executable, feed and update key as $previous"
  fi
  same=1
  for key in $keys; do
    [ "$(info "$app" $key)" = "$(info "$old" $key)" ] || { same=0; echo "      $key: $(info "$old" $key) → $(info "$app" $key)"; }
  done
  check "$what" $same
  if [ "$renamed" = 1 ]; then
    old_feed="$(info "$old" SUFeedURL)" new_feed="$(info "$app" SUFeedURL)"
    to_old="$(curl -s -o /dev/null -m 15 -w '%{redirect_url}' "$old_feed" || true)"
    to_new="$(curl -s -o /dev/null -m 15 -w '%{redirect_url}' "$new_feed" || true)"
    [ -n "$to_new" ] && [ "$to_new" = "$to_old" ] && ok=1 || ok=0
    check "$previous's feed and this build's lead to the same appcast" $ok "$old_feed → ${to_old:-nothing}; $new_feed → ${to_new:-nothing}"
  fi
  old_dr="$(codesign -d -r- "$old" 2>&1 | sed -n 's/^designated => //p')"
  if [ "$renamed" = 1 ]; then
    old_dr="${old_dr//\"$old_id\"/\"$new_id\"}"
    codesign --verify -R="$old_dr" "$app" 2>"$work/dr.log" && ok=1 || ok=0
    check "satisfies $previous's designated requirement under the new bundle id (same team and certificate)" $ok "$(head -c 160 "$work/dr.log")"
  else
    codesign --verify -R="$old_dr" "$app" 2>"$work/dr.log" && ok=1 || ok=0
    check "satisfies $previous's designated requirement (Sparkle, the keychain and TCC trust it)" $ok "$(head -c 160 "$work/dr.log")"
  fi
  [ "$(info "$app" CFBundleVersion)" -gt "$(info "$old" CFBundleVersion)" ] && ok=1 || ok=0
  check "build number above $previous's" $ok "$(info "$old" CFBundleVersion) → $(info "$app" CFBundleVersion)"
else
  check "$previous's export to compare with" 0 "no $old"
fi
zip="$dist/Ardia-$version.zip"
dmg="$dist/Ardia-$version.dmg"
if [ -z "${SMOKE_APP:-}" ]; then
  for f in "$zip" "$dmg" "$dist/appcast.xml"; do [ -f "$f" ] || check "the release has $(basename "$f")" 0; done
  if [ -f "$zip" ] && [ -f "$dist/appcast.xml" ]; then
    swiftc -O "$here/ed25519.swift" -o "$work/ed25519" 2>/dev/null
    read -r signature length < <(python3 -I "$here/appcast.py" enclosure "$dist/appcast.xml" "$version" || true)
    ok=0
    [ -n "$signature" ] && "$work/ed25519" verify "$zip" "$signature" "$(info "$app" SUPublicEDKey)" && [ "$length" = "$(stat -f %z "$zip")" ] && ok=1
    check "the appcast's EdDSA signature of the zip verifies with the app's SUPublicEDKey" $ok "length ${length:-none}"
    mkdir -p "$work/zip" && ditto -x -k "$zip" "$work/zip"
    zapp="$(ls -d "$work/zip"/*.app 2>/dev/null | head -1)"
    [ -n "$zapp" ] && [ -n "$(cdhash "$app")" ] && [ "$(cdhash "$zapp")" = "$(cdhash "$app")" ] \
      && codesign --verify --deep --strict "$zapp" 2>/dev/null && xcrun stapler validate "$zapp" >/dev/null 2>&1 && ok=1 || ok=0
    check "the zip holds this app, sealed and stapled" $ok
    rm -rf "$work/zip"
  fi
fi
spctl -a -vv -t exec "$app" > "$work/spctl.log" 2>&1 && grep -q "source=Notarized Developer ID" "$work/spctl.log" && ok=1 || ok=0
check "Gatekeeper: the app is notarized Developer ID" $ok "$(tr '\n' ' ' < "$work/spctl.log" | head -c 160)"
xcrun stapler validate "$app" >/dev/null 2>&1 && ok=1 || ok=0
check "the app has its notarization ticket stapled" $ok
if [ -z "${SMOKE_APP:-}" ] && [ -f "$dmg" ]; then
  xcrun stapler validate "$dmg" >/dev/null 2>&1 && spctl -a -t open --context context:primary-signature "$dmg" 2>/dev/null && ok=1 || ok=0
  check "the DMG is signed, notarized and stapled" $ok
fi
if [ -d "$old" ]; then
  if [ -z "${SMOKE_APP:-}" ] && [ -f "$dist/appcast.xml" ]; then
    TMPDIR="$work" "$here/update-test.sh" "$old" "$app" "$dist/appcast.xml" "$version" || status=1
  fi
  TMPDIR="$work" "$here/carryover.sh" "$old" "$app" || status=1
fi

swiftc -O "$here/windows.swift" -o "$work/windows" 2>/dev/null
swiftc -O "$here/quit.swift" -o "$work/quit" 2>/dev/null
swiftc -O "$here/keys.swift" -o "$work/keys" 2>/dev/null
swiftc -O "$here/gurl.swift" -o "$work/gurl" 2>/dev/null
serve_dir "$here/pages"

mkdir -p "$work/data"
printf '{"version":1,"lastVersion":"%s","pending":null}' "$previous" > "$work/data/release-notes.json"
pages="http://localhost:$served_port"
SMOKE_PAGES="$pages" node --input-type=module -e '
const { session } = await import(process.argv[1]);
const pages = process.env.SMOKE_PAGES;
console.log(JSON.stringify(session({
  profiles: [{ id: "default", name: "Personal", color: "plum" }, { id: "p-work", name: "Work", color: "blue" }],
  windows: [{ id: "w-smoke", profileId: "p-work", activeTabIds: { default: "t-home", "p-work": "t-pin-a" } }],
  tabs: [
    { id: "t-pin-a", profileId: "p-work", url: `${pages}/count.html?pin-a`, pinned: true, pinnedUrl: `${pages}/count.html?pin-a` },
    { id: "t-home", profileId: "default", url: `${pages}/form.html?home` },
    { id: "t-work", profileId: "p-work", url: `${pages}/form.html?work` },
  ],
})));
' "$root/scripts/lib/instance.mjs" > "$work/data/session.json"

: > "$work/data/perf-probe"

mkdir -p "$work/data/Chromium"
printf '{"profile":{"last_used":"Profile p-work"}}' > "$work/data/Chromium/Local State"

codesign --verify --deep --strict "$app"
launched="$("$root/scripts/agent/ac" launch "$app" --data "$work/data" --js none --no-wait \
  --instance releaseNotes=1 --switch --disable-backgrounding-occluded-windows)" \
  || { echo "error: the app didn't start" >&2; exit 1; }
pid="$(sed -n 's/^pid \([0-9]*\) .*/\1/p' <<<"$launched")"
[ -n "$pid" ] || { echo "error: the app didn't start ($launched)" >&2; exit 1; }
sleep 8

locked="$("$work/windows" --locked)"
[ "$locked" = 1 ] && echo "note: the screen is locked; checks of window order and closing are skipped (they need an unlocked screen)"
SMOKE_LOCKED="$locked" SMOKE_DATA="$work/data" SMOKE_KEYS="$work/keys" SMOKE_GURL="$work/gurl" node "$here/smoke.mjs" "$version" "$work/windows" "$pages" || status=1

children="$(ps -axo ppid=,pid=,comm= | awk -v p="$pid" '$1 == p { $1 = ""; $2 = ""; sub(/^ +/, ""); print }')"
foreign="$(printf '%s\n' "$children" | grep -v "^$fw/Chromium Framework.framework/" | grep -v '^$' || true)"
kinds="$(printf '%s\n' "$children" | sed -n 's/.*Helpers\/\([^/]*\)\.app\/.*/\1/p' | sort | uniq -c | tr -s ' ' | tr '\n' ',')"
[ -z "$foreign" ] && [[ "$kinds" == *"(Renderer)"* ]] && ok=1 || ok=0
check "the browser's child processes are the bundle's own helpers (a renderer among them)" $ok "${kinds%,}${foreign:+; foreign: $foreign}"

log stream --style compact --predicate "process == \"runningboardd\" AND eventMessage CONTAINS \":$pid]\" AND eventMessage CONTAINS \"termination reported\"" \
  > "$work/exit.log" 2>/dev/null &
logger=$!
sleep 1
touch "$work/quit-marker"
"$work/quit" "$pid" >/dev/null || true
tenths=0
while kill -0 "$pid" 2>/dev/null && [ $tenths -lt 150 ]; do sleep 0.1; tenths=$((tenths + 1)); done
if kill -0 "$pid" 2>/dev/null; then
  echo "FAIL  quits cleanly on the quit Apple event  (still running after 15 s)"
  status=1
else
  exited="" report=""
  for _ in $(seq 1 10); do
    sleep 1
    exited="$(grep -o ">:$pid\] termination reported by launchd ([0-9, ]*)" "$work/exit.log" | head -1 | sed 's/.*launchd //' || true)"
    report="$(find ~/Library/Logs/DiagnosticReports ~/Library/Logs/DiagnosticReports/Retired -maxdepth 1 \
      -name 'Ardia-*.ips' -newer "$work/quit-marker" -exec grep -l "\"pid\" : $pid," {} + 2>/dev/null | head -1 || true)"
    [ -n "$report" ] && break
    [ "$exited" = "(0, 0, 0)" ] && break
  done
  detail="exited in $((tenths / 10)).$((tenths % 10)) s, ${exited:-exit status not logged}"
  if [ -z "$report" ] && [ "${exited:-(0, 0, 0)}" = "(0, 0, 0)" ]; then
    echo "PASS  quits cleanly on the quit Apple event  ($detail)"
  else
    echo "FAIL  quits cleanly on the quit Apple event  ($detail${report:+; crash report $report})"
    status=1
  fi
fi
{ kill "$logger"; wait "$logger"; } 2>/dev/null || true
logger=""
kill -KILL "$pid" 2>/dev/null || true
pid=""
node "$root/packages/ardiacore/scripts/popup-check.mjs" "$app" "$work/popup-check" || status=1
codesign --verify --deep --strict "$app" && echo "PASS  bundle still sealed after running" || { echo "FAIL  running the app changed its bundle"; status=1; }
"$here/feed.sh" "$version" --before-publish "$app" || status=1
exit $status
