#!/bin/bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
S=${FIXES_SCRATCH:-$HOME/ardia-scratch/film-0245}
mkdir -p "$S/before" "$S/after" "$S/cli/before" "$S/cli/after"
for side in before after; do
  dir=$([ "$side" = before ] && echo 0.2.44 || echo 0.2.45-nightly.4-rc)
  v=$([ "$side" = before ] && echo 0.2.44 || echo 0.2.45-nightly.4)
  if [ ! -d "$S/$side/Ardia.app" ]; then
    ditto "$REPO/dist/$dir/export/Ardia.app" "$S/$side/Ardia.app"
    codesign --force --deep --sign - "$S/$side/Ardia.app" >/dev/null 2>&1
  fi
  if [ ! -x "$S/cli/$side/bin/ardia" ]; then
    tar xzf "$REPO/dist/$dir/ardia-cli-$v-macos-arm64.tar.gz" -C "$S/cli/$side" --strip-components 1
  fi
done
node "$REPO/apps/videos/scripts/fixes/sessions-release-0245.mjs" "$S"
if ! lsof -nP -iTCP:47231 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup node "$REPO/apps/videos/scripts/capture/sites/serve.mjs" 47231 >"$S/serve.log" 2>&1 &
  echo $! >"$S/serve.pid"
fi
echo "ready in $S"
