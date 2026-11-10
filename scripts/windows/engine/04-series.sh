#!/usr/bin/env bash
# Step 4 (Windows): our series on the tree scripts/windows/engine/03-helium.py left: the series base (series.py capture-base),
# then series_win.py (every `chromium` line of engine/patches/series and engine/patches/series-win, the
# engine/chromium layer and ArdiaCore's hook headers), then the offline game. The table of results goes
# to $CB/logs/series-win.tsv. Fails when a patch does not apply, after trying every one.
# Usage: scripts/windows/engine/04-series.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
export CHROMIUM_SRC="$CB/chromium_git/chromium/src" AC_SERIES_BASE="$CB/series-base"
python3 "$AC_REPO/engine/patches/series.py" capture-base
status=0
python3 "$(dirname "$0")/series_win.py" apply --report "$CB/logs/series-win.tsv" || status=$?
"$AC_MAC_BUILD_DIR/game-resource.sh" --apply
exit "$status"
