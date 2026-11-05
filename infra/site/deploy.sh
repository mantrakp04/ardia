#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
site="$here/../../apps/site"
step="${1:-all}"
. "$here/../lib.sh"
package_limit_mb=48

case "$step" in
  all | build | deploy) ;;
  *) echo "usage: infra/site/deploy.sh [build|deploy]" >&2; exit 64 ;;
esac

if [ "$step" != deploy ]; then
  SITE_URL=https://ardia.dev pnpm -C "$site" exec astro build
  rsync -a --delete --exclude 'release-videos/*.mp4' "$site/dist/" "$here/dist/"
  package_mb=$(( $(du -sk "$here/dist" | cut -f1) / 1024 ))
  if [ "$package_mb" -gt "$package_limit_mb" ]; then
    echo "infra/site/dist is $package_mb MB, over the $package_limit_mb MB budget for Hexclave's 50 MB deploy cap. Largest files:" >&2
    find "$here/dist" -type f -size +400k -exec du -k {} + | sort -rn | head -15 >&2
    exit 1
  fi
  echo "deploy package: $package_mb MB of $package_limit_mb MB"
fi
if [ "$step" != build ]; then
  cd "$here"
  hexclave_deploy
fi
