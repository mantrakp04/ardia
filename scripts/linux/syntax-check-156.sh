#!/usr/bin/env bash
set -euo pipefail
usage() {
  cat <<'EOF'
Usage: scripts/linux/syntax-check-156.sh [--src DIR] [--out DIR] [--work DIR] [--jobs N] [--no-overlay] [--full] [FILTER...]

Runs clang -fsyntax-only over the Linux-built Ardia sources (engine/ardiacore-linux/src/ardia/{linux,core}
and the Linux sources of engine/chromium/src/chrome/browser/ardia) with the compile flags of a Chromium 156
output directory, reading that tree only.

Before checking it stages everything the 156 tree lacks into the work dir:
  gen/      page.mojom headers made with the tree's mojom generator, page_script.h, host_bootstrap.h,
            ac_engine_dispatch.inc and the ardia/core headers the Linux layer copies in
  overlay/  copies of the tree files our engine/patches series touches, with every Linux-applicable
            hunk the tree does not have yet applied to the copy

  --src DIR      Chromium src (default ~/ardia-linux-build-156/chromium_git/chromium/src)
  --out DIR      output dir with the ninja files (default <src>/out/Release_GN_linux_x64)
  --work DIR     scratch dir, recreated on each run, must be outside <src> (default /tmp/v157)
  --jobs N       parallel clang processes, run under nice -n 10 (default 4)
  --no-overlay   check against the bare tree headers, to list what only the patch series provides
  --full         print full diagnostics instead of the error lines
  FILTER         only check files whose path contains one of these substrings

Exits 0 when every file passes.
EOF
}
root=$(cd "$(dirname "$0")/../.." && pwd -P)
src="$HOME/ardia-linux-build-156/chromium_git/chromium/src"
out=""
work=/tmp/v157
jobs=4
overlay=1
full=0
filters=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --src) src=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --work) work=$2; shift 2 ;;
    --jobs) jobs=$2; shift 2 ;;
    --no-overlay) overlay=0; shift ;;
    --full) full=1; shift ;;
    -*) usage >&2; exit 64 ;;
    *) filters+=("$1"); shift ;;
  esac
done
out=${out:-$src/out/Release_GN_linux_x64}
[[ -f "$out/obj/ardia/linux/linux.ninja" ]] || { echo "no $out/obj/ardia/linux/linux.ninja" >&2; exit 64; }
command -v patch >/dev/null || { echo 'Install GNU patch' >&2; exit 64; }
export PYTHONDONTWRITEBYTECODE=1
exec nice -n 10 python3 -I -B "$root/scripts/linux/syntax_check_156.py" "$root" "$src" "$out" "$work" "$jobs" "$overlay" "$full" "${filters[@]}"
