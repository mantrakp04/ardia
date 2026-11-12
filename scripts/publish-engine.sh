#!/usr/bin/env bash
# Publishes this checkout's arm64 engine for CI releases: packs the local Chromium Framework (stripped, unpruned, as
# release.sh packs it) and its source, then uploads both to the GitHub prerelease engine-<engine key:12> (never
# latest) and appends the key's line to packages/ardiacore/prebuilt-engines.tsv. The key (engine/engine-key.sh)
# covers engine/ and the offline game the framework packs.
#
#   scripts/publish-engine.sh [--dry-run] [--out <dir>] [<Chromium Framework.framework>]
#   scripts/publish-engine.sh -h | --help
#
# The framework defaults to $CHROMIUM_SRC/out/Release_GN_arm64 (~/chromium-build/chromium_git/chromium/src). It must
# be fresh: the key's paths committed and pushed, the Chromium tree matching them and nothing in it newer than the build.
# --dry-run packs into <dir> (default dist/engine-<tree:12>), prints the gh commands and the table line, and
# publishes nothing; staleness is a warning there instead of an error. Commit the table line after a real run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$root/scripts/lib/releases.sh"
. "$root/scripts/lib/paths.sh"
table="$root/packages/ardiacore/prebuilt-engines.tsv"
die() { echo "error: $*" >&2; exit 1; }
dry=0 out="" framework=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    --dry-run) dry=1 ;;
    --out) out="${2:?--out takes a directory}"; shift ;;
    -*) die "unknown option $1 (--help)" ;;
    *) framework="$1" ;;
  esac
  shift
done
framework="${framework:-$chromium_src/$chromium_out/Chromium Framework.framework}"
problem() { if [ "$dry" = 1 ]; then echo "warning: $*" >&2; else die "$*"; fi; }
run() {
  printf '+'; printf ' %q' "$@"; echo
  [ "$dry" = 1 ] || "$@"
}

[ -f "$framework/Versions/Current/Chromium Framework" ] || die "no Chromium Framework at $framework"
[[ " $(lipo -archs "$framework/Versions/Current/Chromium Framework") " == *" arm64 "* ]] || die "$framework has no arm64 slice"
tree="$("$root/engine/engine-key.sh")"
key_paths=($("$root/engine/engine-key.sh" --paths))
short="${tree:0:12}"
tag="engine-$short"
commit="$(git -C "$root" rev-parse HEAD)"
[ -z "$(git -C "$root" status --porcelain -- "${key_paths[@]}")" ] || problem "${key_paths[*]} have uncommitted changes: the engine would be published under a key it wasn't built from"
"$root/scripts/lib/engine-fresh.sh" "$framework" "$chromium_src" || problem "the framework isn't built from this checkout's engine sources (above)"
git -C "$root" fetch -q origin main || problem "couldn't fetch origin"
git -C "$root" merge-base --is-ancestor "$commit" origin/main || problem "HEAD ($commit) isn't on origin/main: push it first, the tag $tag points at it"
existing="$(awk -v t="$tree" '$1 == t { print $2; exit }' "$table")"
[ -z "$existing" ] || problem "prebuilt-engines.tsv already lists this engine key under $existing"

out="${out:-$root/dist/$tag}"
rm -rf "$out" && mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
archive="$out/ArdiaCore-$short.tar.xz"
source_archive="$out/ArdiaCore-$short-source.tar.xz"
work="$out/pack"
mkdir -p "$work/Ardia.app/Contents/Frameworks"
echo "==> Copy the engine"
copy=(cp -cR "$framework" "$work/Ardia.app/Contents/Frameworks/")
case "$framework" in
  "$chromium_src/"*) "$root/scripts/agent/locked" chromium --wait 500 -- "${copy[@]}" ;;
  *) "${copy[@]}" ;;
esac
echo "==> Strip"
"$root/packages/ardiacore/scripts/strip-engine.sh" "$work/Ardia.app" "$out/symbols"
echo "==> Pack"
tar --no-mac-metadata -cf - -C "$work/Ardia.app/Contents/Frameworks" "Chromium Framework.framework" | xz -T0 -9 >"$archive"
rm -rf "$work"
sha="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
echo "$sha  $(basename "$archive")" >"$archive.sha256"
echo "==> Source"
"$root/scripts/engine-source.sh" "$tag" "$source_archive" >/dev/null
assets=("$archive" "$archive.sha256" "$source_archive")
line="$(printf '%s\t%s\t%s' "$tree" "$tag" "$sha")"

echo "==> Publish"
notes="ArdiaCore's engine for engine key $tree (commit $commit), for builds without a Chromium tree (packages/ardiacore/scripts/fetch-engine.sh). Not an app release."
if [ "$dry" = 1 ] || ! gh release view "$tag" -R "$REPO" >/dev/null 2>&1; then
  run gh release create "$tag" -R "$REPO" --prerelease --latest=false --target "$commit" --title "Engine $short" --notes "$notes"
fi
run gh release upload "$tag" -R "$REPO" --clobber "${assets[@]}"
if [ "$dry" = 1 ]; then
  echo "dry run: nothing published. The table line would be:"
  echo "$line"
else
  [ "$(gh release view "$tag" -R "$REPO" --json isPrerelease -q .isPrerelease)" = true ] || die "$tag isn't a prerelease"
  printf '%s\n' "$line" >>"$table"
  echo "Published $tag. Commit packages/ardiacore/prebuilt-engines.tsv (appended: $line)."
fi
du -sh "${assets[@]}"
