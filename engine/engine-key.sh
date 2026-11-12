#!/usr/bin/env bash
# The engine's identity: one hash of everything the framework is built from, engine/ and the offline game the
# framework packs (apps/browser/assets/offline-game and its pipeline). Prebuilt engines are published and looked up
# under it (packages/ardiacore/prebuilt-engines.tsv).
#
#   engine/engine-key.sh [<commit>]   the key of <commit> (default HEAD); fails if the commit lacks one of the paths
#   engine/engine-key.sh --paths      the paths the key covers, one per line, relative to the repository
set -euo pipefail

paths=(engine apps/browser/assets/offline-game apps/browser/assets/offline-game-pipeline)
case "${1:-}" in
  -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
  --paths) printf '%s\n' "${paths[@]}"; exit 0 ;;
esac
root="$(cd "$(dirname "$0")/.." && pwd -P)"
commit="${1:-HEAD}"
listing=""
for path in "${paths[@]}"; do
  tree="$(git -C "$root" rev-parse --verify --quiet "$commit:$path")" || { echo "engine-key: $commit has no $path" >&2; exit 1; }
  listing+="$path $tree"$'\n'
done
printf '%s' "$listing" | git -C "$root" hash-object --stdin
