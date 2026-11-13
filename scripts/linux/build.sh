#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
export AC_TARGET_OS=linux
source "$root/engine/patches/build/env.sh"
case "${1:-}" in
  --print-config)
    python3 "$root/engine/patches/build/target_config.py"
    exit 0
    ;;
  --apply) ;;
  *) echo 'Usage: scripts/linux/build.sh --print-config | --apply [--generate]' >&2; exit 64 ;;
esac
[[ "$(uname -s)" == Linux ]] || { echo 'Build on Linux; --print-config works on any host.' >&2; exit 64; }
[[ "$#" -le 2 && ( "$#" -eq 1 || "$2" == --generate ) ]] || { echo 'Unknown build argument' >&2; exit 64; }
command -v flock >/dev/null || { echo 'Install util-linux flock' >&2; exit 64; }
mkdir -p "$CB"
build_root_status=0
python3 "$root/engine/patches/build/pathguard.py" build-root "$CB" >/dev/null || build_root_status=$?
[[ "$build_root_status" -eq 0 || "$build_root_status" -eq 10 ]] || exit "$build_root_status"
export AC_LOCK_ROOT="${AC_LOCK_ROOT:-/tmp}"
mkdir -p "$AC_LOCK_ROOT"
exec "$root/scripts/agent/locked" chromium --wait "${AC_LOCK_WAIT:-30}" -- bash -c '
  set -euo pipefail
  root=$1
  generate=$2
  "$root/engine/patches/build/04-series.sh" --apply
  if [[ "$generate" == --generate ]]; then "$root/engine/patches/build/02-gn-args.sh" --apply; fi
  "$root/engine/patches/build/05-build.sh" --apply
' bash "$root" "${2:-}"
