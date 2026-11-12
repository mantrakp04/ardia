#!/usr/bin/env bash
# Step 2 (Windows): writes out/Release_GN_win_$WIN_CPU/args.gn (WIN_CPU x64 or arm64, default x64) from
# scripts/windows/engine/gn_defines.sh (the Mac list with the Windows changes) and runs `gn gen`. Run it after step 4, and again whenever either list changes.
# Usage: scripts/windows/engine/02-gn-args.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
source "$(dirname "$0")/gn_defines.sh"
src="$CB/chromium_git/chromium/src"
out_dir="$src/out/$GN_OUT_CONFIGS"
mkdir -p "$out_dir"
for path in "$out_dir" "$out_dir/args.gn"; do
  if [[ -L "$path" ]] || { [[ -f "$path" ]] && [[ "$(stat -f %l "$path")" -gt 1 ]]; }; then
    echo "02-gn-args.sh: $path is a link: refusing to write through it" >&2
    exit 64
  fi
done
args_tmp=$(mktemp "$out_dir/.args.gn.XXXXXX")
printf '%s\n' "${_gn_args[@]}" | sort >"$args_tmp"
chmod 644 "$args_tmp"
mv -f "$args_tmp" "$out_dir/args.gn"
cd "$src"
gn gen "out/$GN_OUT_CONFIGS"
