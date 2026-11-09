#!/bin/bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
S=${FIXES_SCRATCH:-$HOME/ardia-scratch/release-0244}
mkdir -p "$S/before" "$S/after" "$S/cli/before" "$S/cli/after"
for side in before after; do
  v=$([ "$side" = before ] && echo 0.2.43 || echo 0.2.44)
  if [ ! -d "$S/$side/Ardia.app" ]; then
    ditto "$REPO/dist/$v/export/Ardia.app" "$S/$side/Ardia.app"
    codesign --force --deep --sign - "$S/$side/Ardia.app" >/dev/null 2>&1
  fi
  if [ ! -x "$S/cli/$side/bin/ardia" ]; then
    tar xzf "$REPO/dist/$v/ardia-cli-$v-macos-arm64.tar.gz" -C "$S/cli/$side" --strip-components 1
  fi
done
node "$REPO/apps/videos/scripts/fixes/sessions-release-0244.mjs" "$S"
if ! lsof -nP -iTCP:47231 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup node "$REPO/apps/videos/scripts/capture/sites/serve.mjs" 47231 >"$S/serve.log" 2>&1 &
  echo $! >"$S/serve.pid"
fi
echo "ready in $S"
