#!/usr/bin/env bash
set -euo pipefail

usage="usage: rollout-everyone.sh <version> [--dry-run] [--break-lock]"
version="${1:?$usage}"
shift
dry=0
break_lock=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --break-lock) break_lock=1 ;;
    *) echo "error: unknown option $arg ($usage)" >&2; exit 1 ;;
  esac
done
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
repo="mantrakp04/ardia"
die() { echo "error: $*" >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "$version isn't a stable version: only a stable release is rolled out in phases"

. "$here/publish-lock.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/ac-rollout.XXXXXX")"
trap 'release_lock; rm -rf "$work"' EXIT
trap 'exit 130' INT TERM HUP
take_lock "rollout $version"

stable_tag="$(gh release view -R "$repo" --json tagName -q .tagName)"
[[ "$stable_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the latest release is $stable_tag, not a stable one: the feed lives on the latest stable release"
published="$(gh release view "$stable_tag" -R "$repo" --json assets -q '.assets[].name')"
grep -qx appcast.xml <<<"$published" || die "$stable_tag has no appcast.xml"
mkdir -p "$work/live" "$work/new"
gh release download "$stable_tag" -R "$repo" -p appcast.xml -D "$work/live"
python3 -I - "$work/live/appcast.xml" "$work/new/appcast.xml" "$version" <<'PY'
import re, sys
source, out, version = sys.argv[1:]
feed = open(source).read()
removed = 0
def strip(match):
    global removed
    item = match.group(0)
    if f"<sparkle:shortVersionString>{version}<" not in item:
        return item
    stripped, count = re.subn(r"[ \t]*<sparkle:phasedRolloutInterval>[^<]*</sparkle:phasedRolloutInterval>\n?", "", item)
    removed += count
    return stripped
result = re.sub(r"<item>.*?</item>", strip, feed, flags=re.S)
if f"<sparkle:shortVersionString>{version}<" not in feed:
    print(f"note: {source.rsplit('/', 1)[-1]} has no item for {version}")
elif removed == 0:
    print(f"note: {version}'s item in {source.rsplit('/', 1)[-1]} has no phased rollout interval")
open(out, "w").write(result)
print(f"{source.rsplit('/', 1)[-1]}: removed {removed} phasedRolloutInterval line(s) from {version}'s item")
PY
if cmp -s "$work/live/appcast.xml" "$work/new/appcast.xml"; then
  echo "nothing to change: $version goes to everyone already"
  exit 0
fi
diff -u "$work/live/appcast.xml" "$work/new/appcast.xml" || true
if [ "$dry" = 1 ]; then
  echo "+ gh release upload $stable_tag -R $repo --clobber $work/new/appcast.xml"
  echo "dry run: nothing uploaded"
  exit 0
fi
gh release upload "$stable_tag" -R "$repo" --clobber "$work/new/appcast.xml"
gh release download "$stable_tag" -R "$repo" -p appcast.xml -O "$work/check-appcast.xml"
cmp -s "$work/new/appcast.xml" "$work/check-appcast.xml" && echo "PASS  $stable_tag's appcast.xml offers $version to everyone" \
  || die "$stable_tag's appcast.xml isn't what was uploaded"
