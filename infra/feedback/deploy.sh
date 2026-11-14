#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
core="$here/../../packages/core/src"
step="${1:-all}"
. "$here/../lib.sh"

case "$step" in
  all | build | deploy) ;;
  *) echo "usage: infra/feedback/deploy.sh [build|deploy]" >&2; exit 64 ;;
esac

if [ "$step" != deploy ]; then
  node --test "$here/test/"*.test.mjs
  rm -rf "$here/core"
  mkdir -p "$here/core"
  cp "$core/anonymousIdentity.ts" "$core/ingestKeys.ts" "$here/core/"
fi
if [ "$step" != build ]; then
  cd "$here"
  hexclave_deploy
fi
