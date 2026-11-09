#!/usr/bin/env bash
# Names the frames of a native crash in Chromium Framework (or any other engine image): finds the engine release whose
# symbols hold the image's UUID, downloads them and runs atos on the offsets.
#
#   scripts/symbolicate-crash.sh [--tag <engine-tag>] [--cache <dir>] <image uuid> <offset>...
#   scripts/symbolicate-crash.sh -h | --help
#
# The UUID and the offsets are what the crash records for the image: "Chromium Framework + 0x2e2334" is the offset
# 0x2e2334, and a leading + is accepted. scripts/publish-engine.sh uploads ArdiaCore-<tree:12>-uuids.txt (one
# "<uuid> <arch> <path>" row per image) and ArdiaCore-<tree:12>-symbols.tar.xz (the unstripped images) to each
# engine-<tree:12> prerelease; the releases are searched newest first, or --tag names one. Downloads are kept in --cache
# (default dist/engine-symbols). Prints "<offset> <frame>" per offset and warns about any atos could not name.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$root/scripts/lib/releases.sh"
die() { echo "error: $*" >&2; exit 1; }
usage="usage: scripts/symbolicate-crash.sh [--tag <engine-tag>] [--cache <dir>] <image uuid> <offset>... (--help)"
tag="" cache="$root/dist/engine-symbols"
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    --tag) tag="${2:?--tag takes an engine release tag}"; shift ;;
    --cache) cache="${2:?--cache takes a directory}"; shift ;;
    -*) die "unknown option $1 (--help)" ;;
    *) break ;;
  esac
  shift
done
[ $# -ge 2 ] || die "$usage"

uuid="$(printf '%s' "$1" | tr 'A-F' 'a-f')"
shift
[[ "$uuid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "$uuid isn't an image UUID (8-4-4-4-12 hex digits)"
offsets=()
for offset in "$@"; do
  offset="${offset#+}"
  [[ "$offset" =~ ^0[xX][0-9a-fA-F]+$ ]] || die "$offset isn't a hex offset like 0x2e2334"
  offsets+=("$offset")
done
for tool in gh atos dwarfdump tar; do
  command -v "$tool" >/dev/null || die "$tool isn't installed"
done

image_row() { awk -F '\t' -v u="$uuid" '$1 == u { print; exit }' "$1"; }
image_uuid() { dwarfdump --uuid "$1" | awk -v a="($2)" '/^UUID: / && $3 == a { print tolower($2); exit }'; }

row=""
if [ -n "$tag" ]; then
  candidates="$tag"
else
  candidates="$(gh release list -R "$REPO" --limit 500 --json tagName -q '.[].tagName')" \
    || die "couldn't list $REPO's releases: is gh signed in?"
  candidates="$(grep '^engine-' <<<"$candidates" || true)"
  [ -n "$candidates" ] || die "$REPO has no engine-* releases"
fi
while IFS= read -r candidate; do
  sidecar="$cache/$candidate/$(engine_uuids_name "$candidate")"
  if [ ! -f "$sidecar" ]; then
    mkdir -p "$cache/$candidate"
    gh release download "$candidate" -R "$REPO" -p "$(engine_uuids_name "$candidate")" -D "$cache/$candidate" --clobber >/dev/null 2>&1 \
      || { [ -z "$tag" ] || die "$candidate has no $(engine_uuids_name "$candidate"): its symbols weren't published"; continue; }
  fi
  row="$(image_row "$sidecar")"
  if [ -n "$row" ]; then
    tag="$candidate"
    break
  fi
  [ "$candidate" != "${tag:-}" ] || die "$candidate's symbols don't list the image $uuid"
done <<<"$candidates"
[ -n "$row" ] || die "no engine release lists the image $uuid: its symbols weren't published (releases before the symbols were uploaded have none)"

IFS=$'\t' read -r _ arch rel <<<"$row"
dir="$cache/$tag"
binary="$dir/symbols/$rel"
if [ "$(image_uuid "$binary" "$arch" 2>/dev/null || true)" != "$uuid" ]; then
  archive="$dir/$(engine_symbols_name "$tag")"
  gh release download "$tag" -R "$REPO" -p "$(engine_symbols_name "$tag")" -D "$dir" --clobber \
    || die "couldn't download $(engine_symbols_name "$tag") from $tag"
  mkdir -p "$dir/symbols"
  tar -xJf "$archive" -C "$dir/symbols" "$rel" || die "couldn't unpack $rel from $(engine_symbols_name "$tag")"
  rm -f "$archive"
  found="$(image_uuid "$binary" "$arch")"
  [ "$found" = "$uuid" ] || die "$rel in $tag has UUID ${found:-none}, not $uuid"
fi

echo "$rel ($uuid, $arch) from $tag" >&2
frames="$(atos -arch "$arch" -o "$binary" -l 0x0 "${offsets[@]}")" || die "atos failed on $rel"
paste <(printf '%s\n' "${offsets[@]}") <(printf '%s\n' "$frames")
unnamed="$(grep -c -E '^0[xX][0-9a-fA-F]+$' <<<"$frames" || true)"
[ "$unnamed" = 0 ] || echo "warning: atos couldn't name $unnamed of ${#offsets[@]} offsets in $rel" >&2
