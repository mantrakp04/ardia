#!/usr/bin/env bash
# The `chromium` and `layer` lines of engine/patches/series, in order (idempotent), then the generated
# offline page. Step 4 runs it after step 3: the patches are made against Helium's tree.
set -euo pipefail
source "$(dirname "$0")/step-guard.sh" "$@"
source "$(dirname "$0")/env.sh"
export CHROMIUM_SRC="$CB/chromium_git/chromium/src"
series="$AC_REPO/engine/patches/series.py"
python3 "$series" capture-base --phase chromium
python3 "$series" apply --phase chromium
