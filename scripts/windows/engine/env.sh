export AC_CHROMIUM_BUILD="${AC_CHROMIUM_BUILD:-$HOME/chromium-build-win}"
export AC_WIN_BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export AC_REPO="${AC_REPO:-$(cd "$AC_WIN_BUILD_DIR/../../.." && pwd)}"
export AC_MAC_BUILD_DIR="$AC_REPO/engine/patches/build"
source "$AC_MAC_BUILD_DIR/env.sh"
export GN_OUT_CONFIGS=Release_GN_win_x64
export HELIUM_WINDOWS_DIR="$CB/helium-windows"
export WIN_TOOLCHAIN_DIR="$CB/win-toolchain"
if [[ -f "$WIN_TOOLCHAIN_DIR/env.sh" ]]; then
  source "$WIN_TOOLCHAIN_DIR/env.sh"
fi
