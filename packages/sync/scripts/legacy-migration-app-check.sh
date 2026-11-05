#!/bin/bash
set -euo pipefail
app="${1:?usage: legacy-migration-app-check.sh <Ardia.app> [scratch dir]}"
here="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(cd "$here/../../.." && pwd -P)"
ac="$repo/scripts/agent/ac"
scratch="${2:-/tmp/ardia-legacy-app-check}"
rm -rf "$scratch" && mkdir -p "$scratch"
scratch="$(cd "$scratch" && pwd -P)"
made="$scratch/made" migrated="$scratch/migrated" home="$scratch/home" clash="$scratch/clash"
apps="${APPS_DIR:-$scratch/apps}"
if [ -n "${APPS_DIR:-}" ]; then
  [ ! -e "$apps" ] || { echo "APPS_DIR $apps exists already; pick a new folder" >&2; exit 1; }
  mkdir -p "$apps" && apps="$(cd "$apps" && pwd -P)"
fi
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
cleanup() {
  for data in "$made" "$migrated" "$clash/data"; do "$ac" quit "$data" --kill >/dev/null 2>&1 || true; done
  for copy in "$apps"/*.app "$clash/apps"/*.app; do [ -d "$copy" ] && "$lsregister" -u "$copy" 2>/dev/null || true; done
  [ -n "${APPS_DIR:-}" ] && rm -rf "$apps"
  true
}
trap cleanup EXIT
fail=0
check() { if [ "$2" = 1 ]; then echo "ok   $1"; else echo "FAIL $1${3:+: $3}"; fail=1; fi; }
release=()
if [ -f "$app/Contents/Resources/main.jsbundle" ]; then
  release=(--js none)
  for data in "$made" "$migrated" "$clash/data"; do mkdir -p "$data" && : > "$data/perf-probe"; done
fi

echo "==> today's build makes data"
"$ac" launch "$app" --data "$made" --onboarded ${release[@]+"${release[@]}"} >/dev/null
"$ac" eval "$made" '
  const s = ac.store.getState();
  const w = Object.keys(s.windows)[0];
  s.updateSettings({ openLinksInLittleArdia: false, littleArdiaSize: [810, 610], shortcuts: { ...s.settings.shortcuts, newLittleArdia: ["cmd+opt+y"] } });
  const history = s.newTab(w, { url: "ardia://history" });
  const example = s.newTab(w, { url: "https://example.com/" });
  ac.store.getState().pinTabs([example], true);
  ac.store.getState().addBookmark({ profileId: "default", url: "ardia://downloads", title: "Migration Bookmark" });
  return [history, example];' >/dev/null
sleep 4
"$ac" page "$made" example.com 'document.cookie = "migration=kept; max-age=999999; path=/"; document.cookie' >/dev/null
sleep 2
"$ac" quit "$made" >/dev/null

echo "==> as an old install"
node "$here/legacy-migration-e2e.mjs" --seed-from "$made" "$home"

echo "==> a copy under the old file name moves itself, then migrates it at launch"
legacy_app="$(sed -n 's/^ *public static let appFileName = "\(.*\)"$/\1/p' "$repo/packages/sync/ios/Core/LegacyMigration.swift")"
[[ "$legacy_app" == *.app ]] || { echo "can't read the legacy app name from LegacyMigration.swift" >&2; exit 1; }
binary="$(plutil -extract CFBundleExecutable raw "$app/Contents/Info.plist")"
mkdir -p "$apps" && { cp -Rc "$app" "$apps/$legacy_app" 2>/dev/null || ditto "$app" "$apps/$legacy_app"; }
echo "    (from $apps)"
launched="$("$ac" launch "$apps/$legacy_app" --runs-from "$apps/Ardia.app" --data "$migrated" --onboarded ${release[@]+"${release[@]}"} \
  --test "legacySource=$home")"
pid="$(sed -n 's/^pid \([0-9]*\) .*/\1/p' <<<"$launched")"
check "it renamed itself to Ardia.app" "$([ -d "$apps/Ardia.app" ] && [ ! -e "$apps/$legacy_app" ] && echo 1 || echo 0)" "$(ls "$apps")"
command="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
check "it runs from Ardia.app" "$([ "$command" = "$apps/Ardia.app/Contents/MacOS/$binary" ] && echo 1 || echo 0)" "$command"
helpers="$(ps -ww -ax -o ppid= -o command= | awk -v p="$pid" '$1 == p' | grep -c "$apps/Ardia.app/Contents/Frameworks/" || true)"
lsinfo="$(lsappinfo info -app "$pid" 2>/dev/null || true)"
check "LaunchServices has it at Ardia.app" "$([[ "$lsinfo" == *"bundle path=\"$apps/Ardia.app\""* ]] && echo 1 || echo 0)" "$(grep "bundle path" <<<"$lsinfo")"
check "its helpers start from Ardia.app" "$([ "${helpers:-0}" -gt 0 ] && echo 1 || echo 0)" "$helpers"
loads() {
  "$ac" eval "$1" 'ac.actions.openUrls(["data:text/html,<title>engine-ok</title>"]); return true' >/dev/null
  sleep 3
  [ "$("$ac" page "$1" "engine-ok" 'document.title' 2>/dev/null || true)" = engine-ok ] && echo 1 || echo 0
}
check "its engine loads a page" "$(loads "$migrated")"
sleep 1
state="$("$ac" eval "$migrated" '
  const s = ac.store.getState();
  const tabs = Object.values(s.tabs);
  const bookmarks = Object.values(s.bookmarks?.default?.nodes ?? s.bookmarks?.nodes ?? {});
  return JSON.stringify({
    urls: tabs.map((t) => t.url),
    pinned: tabs.filter((t) => t.pin).map((t) => t.url),
    little: s.settings.openLinksInLittleArdia,
    size: s.settings.littleArdiaSize,
    shortcut: s.settings.shortcuts?.newLittleArdia ?? null,
    bookmark: JSON.stringify(s.bookmarks).includes("Migration Bookmark") && JSON.stringify(s.bookmarks).includes("ardia://downloads"),
  });')"
echo "$state"
has() { node -e 'const s = JSON.parse(process.argv[1]); process.exit(eval(process.argv[2]) ? 0 : 1)' "$state" "$1" && echo 1 || echo 0; }
check "tabs, with app URLs in today's scheme" "$(has 's.urls.includes("ardia://history") && s.urls.some((u) => u.startsWith("https://example.com"))')"
check "the pinned tab" "$(has 's.pinned.some((u) => u.startsWith("https://example.com"))')"
check "settings" "$(has 's.little === false && s.size[0] === 810')"
check "the custom shortcut" "$(has 'JSON.stringify(s.shortcut) === JSON.stringify(["cmd+opt+y"])')"
check "the bookmark (Chrome's profile)" "$(has 's.bookmark')"
cookie="$("$ac" page "$migrated" example.com 'document.cookie' 2>/dev/null || true)"
check "the site's cookie (Chrome's profile, decrypted with the carried key)" "$([[ "$cookie" == *migration=kept* ]] && echo 1 || echo 0)" "$cookie"
journal="$(cat "$migrated/.legacy-migration.json" 2>/dev/null || true)"
check "the migration's journal says done" "$([[ "$journal" == *'"phase":"done"'* && "$journal" == *'"outcome":"migrated"'* ]] && echo 1 || echo 0)" "$journal"
offer="$(cat "$migrated/default-browser-offer.json" 2>/dev/null || true)"
check "the offer to be the default browser again, left unasked" "$([[ "$offer" == *'"askedAt":null'* ]] && echo 1 || echo 0)" "$offer"
lsinfo="$(lsappinfo info -app "$pid" 2>/dev/null || true)"
check "still hidden after the exec" "$([[ "$lsinfo" == *'type="BackgroundOnly"'* ]] && ! lsappinfo info -app "$(lsappinfo front)" | grep -q "pid = $pid " && echo 1 || echo 0)" "$(grep -o 'type="[^"]*"' <<<"$lsinfo")"
"$ac" quit "$migrated" >/dev/null

echo "==> a copy beside an existing Ardia.app stays where it is"
mkdir -p "$clash/apps" && cp -Rc "$app" "$clash/apps/$legacy_app" && cp -Rc "$app" "$clash/apps/Ardia.app"
launched="$("$ac" launch "$clash/apps/$legacy_app" --data "$clash/data" --onboarded ${release[@]+"${release[@]}"})"
pid="$(sed -n 's/^pid \([0-9]*\) .*/\1/p' <<<"$launched")"
command="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
check "it runs under its old name" "$([ "$command" = "$clash/apps/$legacy_app/Contents/MacOS/$binary" ] && [ -d "$clash/apps/$legacy_app" ] && echo 1 || echo 0)" "$command"
check "its engine loads a page" "$(loads "$clash/data")"
"$ac" quit "$clash/data" >/dev/null
[ "$fail" = 0 ] && echo "all passed" || echo "FAILED (scratch: $scratch)"
exit "$fail"
