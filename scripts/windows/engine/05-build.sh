#!/usr/bin/env bash
# Step 5 (Windows): compile out/Release_GN_win_x64. TARGETS defaults to base_unittests (proves the toolchain),
# then chrome. JOBS sets siso's local jobs, compiles and links alike (default 8: on a 24 GB machine siso's own
# default ran Blink's bindings generators nine at a time, each with a worker per core, and swapped the machine).
# KEEP_GOING is -k (0: keep going past failures).
# Usage: scripts/windows/engine/05-build.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
CHROMIUM_SRC="$CB/chromium_git/chromium/src" "$AC_MAC_BUILD_DIR/game-resource.sh" --apply
cd "$CB/chromium_git/chromium/src"
TARGETS="${TARGETS:-base_unittests}"
exec autoninja -j "${JOBS:-8}" -k "${KEEP_GOING:-0}" -C "out/$GN_OUT_CONFIGS" $TARGETS
