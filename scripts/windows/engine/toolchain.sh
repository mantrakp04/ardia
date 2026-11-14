#!/usr/bin/env bash
# The Windows toolchain for the cross build, with no Windows machine: downloads Visual Studio 2026's C++ build
# tools and Windows SDK $WIN_SDK_VERSION from Microsoft (msvc-wine's vsdownload.py, accepting Microsoft's licence)
# into $WIN_TOOLCHAIN_DIR/msvc, packs them as package_from_installed.py would (package_toolchain.py) into
# $WIN_TOOLCHAIN_DIR/zips/<hash>.zip, and writes $WIN_TOOLCHAIN_DIR/env.sh, which scripts/windows/engine/env.sh sources:
# DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL and GYP_MSVS_HASH_<Chromium's toolchain hash>=<ours>. Then run
# scripts/windows/engine/01-sync.sh again (its hooks unpack the zip into depot_tools/win_toolchain/vs_files).
# The SDK inside Visual Studio's packages has no Debuggers: Microsoft's debugger engine package (NuGet
# Microsoft.Debugging.Platform.DbgEng $DBGENG_VERSION) gives Debuggers/<cpu>/dbghelp.dll and dbgcore.dll.
# Usage: scripts/windows/engine/toolchain.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
WIN_SDK_VERSION=10.0.28000.0
VS_MAJOR=18
VS_YEAR=2026
MSVC_WINE_COMMIT=fe512cf4083e9124ebc3e0d0950ce96e621985d1
src="$CB/chromium_git/chromium/src"
chromium_hash=$(python3 -c 'import re,sys; print(re.search(r"^TOOLCHAIN_HASH = .(\w+).", open(sys.argv[1]).read(), re.M).group(1))' "$src/build/vs_toolchain.py")
chromium_sdk=$(python3 -c 'import re,sys; print(re.search(r"^SDK_VERSION = .([\d.]+).", open(sys.argv[1]).read(), re.M).group(1))' "$src/build/vs_toolchain.py")
[[ "$chromium_sdk" == "$WIN_SDK_VERSION" ]] || { echo "toolchain.sh: this Chromium wants SDK $chromium_sdk, not $WIN_SDK_VERSION" >&2; exit 1; }
command -v msiextract >/dev/null || brew install msitools
mkdir -p "$WIN_TOOLCHAIN_DIR"
if [[ ! -d "$WIN_TOOLCHAIN_DIR/msvc-wine/.git" ]]; then
  git clone -q https://github.com/mstorsjo/msvc-wine.git "$WIN_TOOLCHAIN_DIR/msvc-wine"
fi
git -C "$WIN_TOOLCHAIN_DIR/msvc-wine" -c advice.detachedHead=false switch -q --detach "$MSVC_WINE_COMMIT"
if [[ ! -d "$WIN_TOOLCHAIN_DIR/msvc/VC/Tools/MSVC" ]]; then
  python3 "$WIN_TOOLCHAIN_DIR/msvc-wine/vsdownload.py" --accept-license --major "$VS_MAJOR" \
    --sdk-version "${WIN_SDK_VERSION%.0}" --with-atl yes --with-mfc no --with-dia yes --with-msbuild no \
    --with-devcmd no --with-llvm no --with-asan no --architecture x64 x86 arm64 --skip-patch \
    --cache "$WIN_TOOLCHAIN_DIR/cache" --dest "$WIN_TOOLCHAIN_DIR/msvc"
fi
if [[ ! -f "$DBGENG_DIR/content/arm64/dbghelp.dll" ]]; then
  mkdir -p "$DBGENG_DIR"
  curl -fsSL -o "$DBGENG_DIR.nupkg" \
    "https://api.nuget.org/v3-flatcontainer/microsoft.debugging.platform.dbgeng/$DBGENG_VERSION/microsoft.debugging.platform.dbgeng.$DBGENG_VERSION.nupkg"
  unzip -q -o "$DBGENG_DIR.nupkg" -d "$DBGENG_DIR"
fi
python3 "$(dirname "$0")/package_toolchain.py" --msvc "$WIN_TOOLCHAIN_DIR/msvc" --winver "$WIN_SDK_VERSION" \
  --vs-version "$VS_YEAR" --depot-tools "$CB/depot_tools" --out "$WIN_TOOLCHAIN_DIR/zips" --stored \
  --debuggers-from "$DBGENG_DIR" | tee "$WIN_TOOLCHAIN_DIR/package.log"
ours=$(awk '/^hash /{print $2}' "$WIN_TOOLCHAIN_DIR/package.log")
[[ -n "$ours" ]] || { echo "toolchain.sh: packaging gave no hash" >&2; exit 1; }
cat > "$WIN_TOOLCHAIN_DIR/env.sh" <<ENV
export DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL="$WIN_TOOLCHAIN_DIR/zips"
export GYP_MSVS_HASH_$chromium_hash=$ours
ENV
echo "toolchain $ours for Chromium's $chromium_hash: $WIN_TOOLCHAIN_DIR/zips/$ours.zip"
