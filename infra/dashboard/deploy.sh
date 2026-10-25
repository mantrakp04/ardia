#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../../apps/dashboard"
hexclave=(${HEXCLAVE:-npx @hexclave/cli@1.0.133})

rsync -a --delete --exclude node_modules --exclude dist --exclude .output --exclude .tanstack --exclude src/routeTree.gen.ts "$app/" "$here/app/"
cd "$here"
"${hexclave[@]}" deploy --cloud-project-id 49be2e2e-87c4-433e-b42f-f255854bff56
