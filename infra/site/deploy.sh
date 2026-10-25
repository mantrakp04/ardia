#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
infra="$(cd "$here/.." && pwd)"
site="$here/../../apps/site"
step="${1:-all}"
hexclave=(${HEXCLAVE:-"$infra/node_modules/.bin/hexclave"})

case "$step" in
  all | build | deploy) ;;
  *) echo "usage: infra/site/deploy.sh [build|deploy]" >&2; exit 64 ;;
esac

if [ "$step" != deploy ]; then
  SITE_URL=https://ardia.dev pnpm -C "$site" exec astro build
  rsync -a --delete "$site/dist/" "$here/dist/"
fi
if [ "$step" != build ]; then
  pnpm -C "$infra" install --frozen-lockfile --ignore-workspace
  cd "$here"
  "${hexclave[@]}" deploy --cloud-project-id 49be2e2e-87c4-433e-b42f-f255854bff56
fi
