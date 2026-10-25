#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
repo=${ARDIACORE_PREBUILT_REPO:-mantrakp04/ardia}
assets=${ARDIACORE_PREBUILT_ASSETS:-https://github.com/$repo/releases/download}
table="$here/../prebuilt-engines.tsv"
name="Chromium Framework"
die() { echo "error: $*" >&2; exit 1; }
usage() { die "usage: fetch-engine.sh [--arch arm64|x86_64] [--nearest]"; }

nearest=0 arch=arm64
while [ $# -gt 0 ]; do
  case "$1" in
    --nearest) nearest=1 ;;
    --arch) [ $# -ge 2 ] || usage; arch=$2; shift ;;
    --arch=*) arch=${1#--arch=} ;;
    *) usage ;;
  esac
  shift
done
case "$arch" in
  arm64) store="$root/apps/browser/build-ardiacore/prebuilt" ;;
  x86_64) store="$root/apps/browser/build-ardiacore/prebuilt-x86_64" ;;
  *) usage ;;
esac

git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || die "$root isn't a git checkout: a prebuilt engine is matched to engine/'s git tree"
[ -z "$(git -C "$root" status --porcelain -- engine)" ] \
  || die "engine/ has uncommitted changes, and no prebuilt has them: build the engine (docs/engine-build.md)"
tree=$(git -C "$root" rev-parse HEAD:engine)

remote_table=""
lookup_arm64() {
  local line
  line=$(awk -v t="$1" '$1 == t { print; exit }' "$table" 2>/dev/null || true)
  if [ -z "$line" ]; then
    [ -n "$remote_table" ] || remote_table=$(curl -fsL --retry 2 "https://raw.githubusercontent.com/$repo/main/packages/ardiacore/prebuilt-engines.tsv" || echo "#")
    line=$(awk -v t="$1" '$1 == t { print; exit }' <<<"$remote_table")
  fi
  echo "$line"
}
lookup_x86_64() {
  local short=${1:0:12} sum
  sum=$(curl -fsL --retry 2 "$assets/engine-$short/ArdiaCore-$short-x64.tar.xz.sha256" 2>/dev/null | awk '{ print $1; exit }') || return 0
  [[ "$sum" =~ ^[0-9a-f]{64}$ ]] && printf '%s\tengine-%s\t%s\n' "$1" "$short" "$sum"
  return 0
}
lookup() {
  [ -n "$1" ] || return 0
  "lookup_$arch" "$1"
}
release_tag() {
  case "$1" in engine-*) echo "$1" ;; *) echo "v$1" ;; esac
}

entry=$(lookup "$tree")
if [ -z "$entry" ]; then
  skipped=0 found=""
  while read -r commit; do
    candidate=$(lookup "$(git -C "$root" rev-parse "$commit:engine" 2>/dev/null || true)")
    if [ -n "$candidate" ]; then found=$candidate; break; fi
    skipped=$((skipped + 1))
    [ "$skipped" -lt 200 ] || break
  done < <(git -C "$root" rev-list HEAD -- engine)
  [ -n "$found" ] || die "no prebuilt $arch engine for this checkout or any earlier one: build the engine (docs/engine-build.md)"
  version=$(awk '{ print $2 }' <<<"$found")
  if [ "$nearest" = 0 ]; then
    die "no prebuilt $arch engine for this checkout's engine/ ($skipped engine commits since $version's). Check out \
$(release_tag "$version"), or run packages/ardiacore/scripts/fetch-engine.sh --arch $arch --nearest to build against \
$version's engine anyway, or build the engine"
  fi
  echo "warning: using $version's $arch engine; engine/ changed in $skipped commits since, and the app may not match it" >&2
  entry=$found
fi
read -r tree version sha <<<"$entry"
short=${tree:0:12}
dest="$store/$short"
if [ ! -f "$dest/.complete" ]; then
  if [ "$arch" = x86_64 ]; then file="ArdiaCore-$short-x64.tar.xz"; else file="ArdiaCore-$short.tar.xz"; fi
  url="$assets/$(release_tag "$version")/$file"
  tmp="$store/.tmp-$$"
  rm -rf "$tmp" && mkdir -p "$tmp"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading the $arch engine from $version ($url)" >&2
  curl -fL --retry 3 --progress-bar -o "$tmp/$file" "$url" || die "couldn't download $url"
  [ "$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')" = "$sha" ] || die "$file doesn't match its SHA-256"
  tar -xJf "$tmp/$file" -C "$tmp" || die "couldn't unpack $file"
  [ -f "$tmp/$name.framework/Versions/Current/$name" ] || die "$file holds no $name.framework"
  if [ "$arch" = x86_64 ] && command -v lipo >/dev/null; then
    [ "$(lipo -archs "$tmp/$name.framework/Versions/Current/$name")" = x86_64 ] || die "$file isn't an x86_64 engine"
  fi
  rm -f "$tmp/$file"
  touch "$tmp/.complete"
  rm -rf "$dest"
  mv "$tmp" "$dest"
  trap - EXIT
  for old in "$store"/*/; do
    [ "${old%/}" = "$dest" ] || rm -rf "${old%/}"
  done
fi
echo "$dest/$name.framework"
