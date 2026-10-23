#!/usr/bin/env bash
# Step 1: check out Chromium $CHROMIUM_VERSION (env.sh) for the Mac, without history, and run its
# hooks; no build. Then step 3 (Helium and its substitutions), step 4 (our series), step 2 (GN args)
# and step 5 (build).
set -euo pipefail
source "$(dirname "$0")/step-guard.sh" "$@"
source "$(dirname "$0")/env.sh"
rm -rf "$CB/series-base"
mkdir -p "$CB/chromium_git/chromium"
cd "$CB/chromium_git/chromium"
cat > .gclient <<GCLIENT
solutions = [{'managed': False, 'name': 'src',
  'url': 'https://chromium.googlesource.com/chromium/src.git@refs/tags/$CHROMIUM_VERSION',
  'custom_vars': {'checkout_pgo_profiles': True, 'source_tarball': False, 'siso_version': 'latest'},
  'custom_deps': {}, 'deps_file': 'DEPS', 'safesync_url': ''}]
target_os = ['mac']
GCLIENT
if [ -d src/.git ]; then
  lowprio_net timeout 3600 git -C src fetch --depth=1 --no-tags origin "refs/tags/$CHROMIUM_VERSION:refs/tags/$CHROMIUM_VERSION"
  git -C src -c advice.detachedHead=false checkout -q -f "refs/tags/$CHROMIUM_VERSION"
fi
lowprio_net timeout 7200 gclient sync --no-history --nohooks --reset --force -D -j 16
lowprio_net gclient runhooks
