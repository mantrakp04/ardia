#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../../apps/dashboard"
. "$here/../lib.sh"

rsync -a --delete --exclude node_modules --exclude dist --exclude .output --exclude .tanstack --exclude src/routeTree.gen.ts "$app/" "$here/app/"
mkdir -p "$here/site/src/data"
cp "$here/../../apps/site/src/data/telemetry.ts" "$here/site/src/data/telemetry.ts"
cd "$here"
hexclave_deploy
