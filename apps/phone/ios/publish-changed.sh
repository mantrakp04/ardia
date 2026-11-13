#!/bin/bash
set -euo pipefail
from=$1 to=$2
shift 2
excludes=()
while [[ $# -gt 0 ]]; do
  [[ "$1" == --exclude && $# -ge 2 ]] || { echo "publish-changed.sh: unknown argument $1" >&2; exit 64; }
  excludes+=("$2")
  shift 2
done
[[ -d "$from" ]] || exit 0
cd "$from"
find . -type f | while IFS= read -r rel; do
  rel=${rel#./}
  skip=""
  for glob in ${excludes[@]+"${excludes[@]}"}; do
    # shellcheck disable=SC2053
    [[ "$(basename "$rel")" == $glob ]] && skip=1
  done
  [[ -n "$skip" ]] && continue
  target="$to/$rel"
  cmp -s "$rel" "$target" && continue
  mkdir -p "$(dirname "$target")"
  tmp="$(dirname "$target")/.$(basename "$target").$$"
  cp "$rel" "$tmp"
  mv -f "$tmp" "$target"
  echo "publish-changed: updated $target"
done
