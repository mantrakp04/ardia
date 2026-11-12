export AC_CHROMIUM_BUILD="${AC_CHROMIUM_BUILD:-$HOME/chromium-build-win}"
export AC_WIN_BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export AC_REPO="${AC_REPO:-$(cd "$AC_WIN_BUILD_DIR/../../.." && pwd)}"
export AC_MAC_BUILD_DIR="$AC_REPO/engine/patches/build"
source "$AC_MAC_BUILD_DIR/env.sh"
export WIN_CPU="${WIN_CPU:-x64}"
export GN_OUT_CONFIGS="Release_GN_win_$WIN_CPU"
export HELIUM_WINDOWS_DIR="$CB/helium-windows"
export WIN_TOOLCHAIN_DIR="$CB/win-toolchain"
export DBGENG_VERSION=20260319.1511.0
export DBGENG_DIR="$WIN_TOOLCHAIN_DIR/dbgeng/pkg-$DBGENG_VERSION"
if [[ -f "$WIN_TOOLCHAIN_DIR/env.sh" ]]; then
  source "$WIN_TOOLCHAIN_DIR/env.sh"
fi
