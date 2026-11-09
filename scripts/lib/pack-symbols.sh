#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/lib/pack-symbols.sh <symbols dir> <symbols archive> <uuids file>"
symbols="${1:?$usage}"
archive="${2:?$usage}"
uuids="${3:?$usage}"
die() { echo "error: $*" >&2; exit 1; }
asset_limit=$((2 * 1024 * 1024 * 1024))

[ -d "$symbols" ] || die "no symbols folder at $symbols"
symbols="$(cd "$symbols" && pwd -P)"
list="$(mktemp)"
trap 'rm -f "$list" "$uuids.part"' EXIT

(cd "$symbols" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) >"$list"
grep -qxF "Chromium Framework" "$list" || die "$symbols holds no Chromium Framework"

while IFS= read -r rel; do
  found="$(dwarfdump --uuid "$symbols/$rel" | awk -v rel="$rel" '/^UUID: / { arch = $3; gsub(/[()]/, "", arch); print tolower($2) "\t" arch "\t" rel }')" \
    || die "dwarfdump --uuid failed on $rel"
  [ -n "$found" ] || die "$rel has no UUID"
  printf '%s\n' "$found"
done <"$list" >"$uuids.part"
mv "$uuids.part" "$uuids"

(cd "$symbols" && COPYFILE_DISABLE=1 tar -cf - -T "$list") | xz -T0 -9 >"$archive"
size="$(wc -c <"$archive" | tr -d ' ')"
[ "$size" -lt "$asset_limit" ] || die "$(basename "$archive") is $size bytes, over GitHub's 2 GiB limit for a release asset"
echo "    $(wc -l <"$list" | tr -d ' ') images: $(basename "$archive") ($((size / 1048576)) MB), $(basename "$uuids")"
