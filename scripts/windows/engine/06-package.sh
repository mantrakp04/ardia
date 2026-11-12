#!/usr/bin/env bash
# Step 6 (Windows): pack out/Release_GN_win_$WIN_CPU (WIN_CPU x64 or arm64) into
# $PACKAGE_DIR/ardia-chromium-win-$WIN_CPU.zip (default ~/ardia-windows/out) and update SHA256SUMS beside it.
# The file list is the tree's own: the chrome-win.zip archive of infra/archive_config/win-archive-rel.json
# (win-arm64-archive-rel.json for arm64), the snapshot CI uploads, packed by chrome/tools/build/make_zip.py. Its paths
# are written for a Windows host (locales\*.pak), so make_zip.py reads a copy with forward slashes. The zip's
# files are then checked against `gn desc ... //chrome:chrome runtime_deps`; what the zip lacks is listed in
# $CB/package/$WIN_CPU/missing-runtime-deps.txt (debug files apart). RUN.txt goes in, under chrome-win/.
# Usage: scripts/windows/engine/06-package.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
src="$CB/chromium_git/chromium/src"
out="out/$GN_OUT_CONFIGS"
package_dir="${PACKAGE_DIR:-$HOME/ardia-windows/out}"
work="$CB/package/$WIN_CPU"
name="ardia-chromium-win-$WIN_CPU"
case "$WIN_CPU" in
  x64) config=win-archive-rel.json ;;
  arm64) config=win-arm64-archive-rel.json ;;
  *) echo "06-package.sh: WIN_CPU must be x64 or arm64" >&2; exit 64 ;;
esac
[[ -f "$src/$out/chrome.exe" && -f "$src/$out/chrome.dll" ]] || { echo "06-package.sh: build chrome in $out first" >&2; exit 1; }
mkdir -p "$work" "$package_dir"
python3 -c 'import sys; open(sys.argv[2], "w").write(open(sys.argv[1]).read().replace("\\\\", "/"))' \
  "$src/infra/archive_config/$config" "$work/archive_config.json"
cd "$src"
gn desc "$out" //chrome:chrome runtime_deps > "$work/runtime_deps.txt"
python3 "$(dirname "$0")/package_win.py" --src "$src" --out "$out" --config "$work/archive_config.json" \
  --runtime-deps "$work/runtime_deps.txt" --work "$work" --zip "$package_dir/$name.zip" --cpu "$WIN_CPU" \
  --chromium "$CHROMIUM_VERSION" --helium "$HELIUM_TAG"
cd "$package_dir"
shasum -a 256 ardia-chromium-win-*.zip > SHA256SUMS
cat SHA256SUMS
