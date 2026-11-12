#!/bin/bash
set -uo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
export FIXES_SCRATCH=${FIXES_SCRATCH:-$HOME/ardia-scratch/film-0245}
export BEFORE_APP=$FIXES_SCRATCH/before/Ardia.app
export AFTER_APP=$FIXES_SCRATCH/after/Ardia.app
export AFTER_JS=none
export FIXES_HOVER=1 FIXES_INPUT=1 FIXES_SERIAL=1 FIXES_PORT_BASE=${FIXES_PORT_BASE:-9581}
exec node "$REPO/apps/videos/scripts/fixes/run.mjs" "$@"
