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
. "$root/scripts/lib/releases.sh"
die() { echo "error: $*" >&2; exit 1; }
[ "$(channel_of "$version")" = stable ] || die "$version isn't a stable version: only a stable release is rolled out in phases"

. "$here/publish-lock.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/ac-rollout.XXXXXX")"
trap 'release_lock; rm -rf "$work"' EXIT
trap 'exit 130' INT TERM HUP
take_lock "rollout $version" "$dry" "$break_lock"

stable_tag="$(latest_stable_tag)"
download_live_feed "$stable_tag" "$work/live" || die "$stable_tag has no appcast.xml"
mkdir -p "$work/new"
appcast strip-phased "$work/live/appcast.xml" "$version" "$work/new/appcast.xml"
if cmp -s "$work/live/appcast.xml" "$work/new/appcast.xml"; then
  echo "nothing to change: $version goes to everyone already"
  exit 0
fi
diff -u "$work/live/appcast.xml" "$work/new/appcast.xml" || true
if [ "$dry" = 1 ]; then
  echo "+ gh release upload $stable_tag -R $REPO --clobber $work/new/appcast.xml"
  echo "dry run: nothing uploaded"
  exit 0
fi
gh release upload "$stable_tag" -R "$REPO" --clobber "$work/new/appcast.xml"
gh release download "$stable_tag" -R "$REPO" -p appcast.xml -O "$work/check-appcast.xml"
cmp -s "$work/new/appcast.xml" "$work/check-appcast.xml" && echo "PASS  $stable_tag's appcast.xml offers $version to everyone" \
  || die "$stable_tag's appcast.xml isn't what was uploaded"
