#!/usr/bin/env bash
# Step 5: compile at normal priority; autoninja picks the job count (JOBS overrides).
# -k 0 keeps going past failures so one pass surfaces every broken file.
set -euo pipefail
source "$(dirname "$0")/step-guard.sh" "$@"
source "$(dirname "$0")/env.sh"
CHROMIUM_SRC="$CB/chromium_git/chromium/src" "$(dirname "$0")/game-resource.sh" --apply
cd "$CB/chromium_git/chromium/src"
# ArdiaCore is Chrome's own framework (the app stages it from out/Release_GN_arm64).
TARGETS="${TARGETS:-chrome_framework}"
exec autoninja ${JOBS:+-j "$JOBS"} -k "${KEEP_GOING:-0}" -C "out/$GN_OUT_CONFIGS" $TARGETS
