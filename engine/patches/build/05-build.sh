#!/usr/bin/env bash
# Step 5: compile at normal priority; autoninja picks the job count (JOBS overrides).
# -k 0 keeps going past failures so one pass surfaces every broken file.
set -euo pipefail
source "$(dirname "$0")/step-guard.sh" "$@"
source "$(dirname "$0")/env.sh"
cd "$CB/chromium_git/chromium/src"
# ArdiaCore is Chrome's own framework (the app stages it from out/Release_GN_arm64).
case "$(uname -s):$AC_TARGET_OS" in
  Darwin:mac | Linux:linux) ;;
  *) echo "05-build.sh: run on the target operating system ($AC_TARGET_OS)" >&2; exit 64 ;;
esac
python3 "$AC_REPO/engine/patches/build/pathguard.py" output "$PWD" "$GN_OUT_CONFIGS"
CHROMIUM_SRC="$PWD" "$AC_REPO/engine/patches/build/game-resource.sh" --apply
read -r -a build_targets <<< "${TARGETS:-$AC_CHROMIUM_TARGET}"
build_flags=()
if [[ -n "${JOBS:-}" ]]; then build_flags+=(-j "$JOBS"); fi
exec autoninja "${build_flags[@]}" -k "${KEEP_GOING:-0}" -C "out/$GN_OUT_CONFIGS" "${build_targets[@]}"
