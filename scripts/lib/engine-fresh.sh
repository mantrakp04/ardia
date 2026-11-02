#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/lib/engine-fresh.sh <Chromium Framework.framework> <chromium src>"
framework_src="${1:?$usage}"
chromium_src="${2:?$usage}"
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
die() { echo "error: $*" >&2; exit 1; }

for layer in ardiacore chromium; do
  "$root/engine/$layer/apply.sh" --check \
    || die "the Chromium tree differs from engine/$layer: run engine/$layer/apply.sh and rebuild chrome_framework"
done
newest="$(find "$chromium_src/ardia" "$chromium_src/chrome/browser/ardia" -type f \
  -newer "$framework_src/Versions/Current/Chromium Framework" -print -quit)"
[ -z "$newest" ] || die "$newest is newer than the framework: rebuild chrome_framework (scripts/agent/engine-build, docs/engine-build.md)"
framework_newest="$(find "$framework_src/Versions/Current/" -type f -exec stat -f '%m %N' {} + | sort -n | tail -1 | cut -d' ' -f2-)"
newest="$(cd "$chromium_src" && "$root/engine/chromium/apply.sh" --paths | while read -r path; do
  [ "$path" -nt "$framework_newest" ] && { echo "$path"; break; }; done || true)"
[ -z "$newest" ] || die "$newest is newer than the framework: rebuild chrome_framework (scripts/agent/engine-build, docs/engine-build.md)"
