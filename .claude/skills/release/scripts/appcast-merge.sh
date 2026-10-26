#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: appcast-merge.sh <version> [published feed URL, file or none]}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
dist="${RELEASE_DIST:-$root/dist/$version}"
source="${2:-https://github.com/mantrakp04/ardia/releases/latest/download/appcast.xml}"
built="$dist/appcast.xml"
[ -f "$built" ] || { echo "error: no $built (scripts/release.sh $version first)" >&2; exit 1; }
built_copy="$dist/appcast.built.xml"
[ -f "$built_copy" ] || cp "$built" "$built_copy"
if [ "$source" = none ]; then
  echo "PASS  appcast for $version is appcast.xml as built (no published feed to merge onto)"
  exit 0
fi
live="$(mktemp "${TMPDIR:-/tmp}/ac-feed.XXXXXX")"
trap 'rm -f "$live"' EXIT
case "$source" in
  http://* | https://*) curl -fsSL --max-time 30 --retry 2 "$source" -o "$live" ;;
  *) cp "$source" "$live" ;;
esac
python3 -I - "$live" "$built_copy" "$version" "$built" <<'PY'
import re, sys
live_path, built_path, version, out_path = sys.argv[1:]
item_pattern = re.compile(r"[ \t]*<item>.*?</item>\n?", re.S)
def build_of(item):
    found = re.search(r"<sparkle:version>([^<]+)</sparkle:version>", item)
    return found.group(1) if found else None
def channel_of(item):
    found = re.search(r"<sparkle:channel>([^<]+)</sparkle:channel>", item)
    return found.group(1) if found else "stable"
live = open(live_path).read()
built = open(built_path).read()
if "xmlns:sparkle" not in live or "<channel>" not in live:
    sys.exit(f"error: {live_path} isn't a Sparkle appcast")
mine = [i for i in item_pattern.findall(built) if f"<sparkle:shortVersionString>{version}<" in i]
if len(mine) != 1:
    sys.exit(f"error: {built_path} has {len(mine)} items for {version}")
item = mine[0]
build = build_of(item)
live_items = item_pattern.findall(live)
clash = [i for i in live_items if build_of(i) == build and f"<sparkle:shortVersionString>{version}<" not in i]
if clash:
    sys.exit(f"error: the published feed already has build {build} as another version; bump CURRENT_PROJECT_VERSION and rebuild")
kept = [i for i in live_items if build_of(i) != build]
head = live[: live.index("<item>")] if live_items else live[: live.index("</channel>")]
head = re.sub(r"[ \t]*$", "", head)
merged = head + "        " + item.strip() + "\n" + "".join(kept)
if not live_items:
    merged += "    </channel>\n</rss>\n"
else:
    merged += live[live.rindex("</item>") + len("</item>"):].lstrip("\n")
open(out_path, "w").write(merged)
counts = {}
for i in [item] + kept:
    counts[channel_of(i)] = counts.get(channel_of(i), 0) + 1
summary = ", ".join(f"{n} {c}" for c, n in sorted(counts.items()))
print(f"PASS  appcast for {version} (build {build}, {channel_of(item)}) merged onto the published feed ({summary})")
PY
