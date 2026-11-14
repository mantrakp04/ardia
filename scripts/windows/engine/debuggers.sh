#!/usr/bin/env bash
# The SDK inside Visual Studio's packages has no "Debugging Tools for Windows", and vs_toolchain.py copies
# Windows Kits/10/Debuggers/<cpu>/dbghelp.dll into every out dir. This takes Microsoft's debugger engine package
# (NuGet Microsoft.Debugging.Platform.DbgEng $DBGENG_VERSION in env.sh, under the Windows SDK licence) into
# $WIN_TOOLCHAIN_DIR/dbgeng and puts its dbghelp.dll and dbgcore.dll for every CPU the unpacked toolchain lacks
# into it. `gclient runhooks` re-unpacks the zip when the toolchain's files changed, which undoes this: run it again
# after the hooks, or make a new zip (toolchain.sh passes the package to package_toolchain.py).
# Usage: scripts/windows/engine/debuggers.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
pkg="$DBGENG_DIR"
if [[ ! -f "$pkg/content/arm64/dbghelp.dll" ]]; then
  mkdir -p "$WIN_TOOLCHAIN_DIR/dbgeng"
  nupkg="$WIN_TOOLCHAIN_DIR/dbgeng/dbgeng-$DBGENG_VERSION.nupkg"
  curl -fsSL -o "$nupkg" \
    "https://api.nuget.org/v3-flatcontainer/microsoft.debugging.platform.dbgeng/$DBGENG_VERSION/microsoft.debugging.platform.dbgeng.$DBGENG_VERSION.nupkg"
  mkdir -p "$pkg"
  unzip -q -o "$nupkg" -d "$pkg"
fi
vs=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["path"])' "$CB/chromium_git/chromium/src/build/win_toolchain.json")
for pair in amd64:x64 x86:x86 arm64:arm64; do
  from="$pkg/content/${pair%%:*}"
  to="$vs/Windows Kits/10/Debuggers/${pair##*:}"
  if [[ ! -f "$to/dbghelp.dll" ]]; then
    mkdir -p "$to"
    cp "$from/dbghelp.dll" "$from/dbgcore.dll" "$to/"
    echo "added Debuggers/${pair##*:} from DbgEng $DBGENG_VERSION"
  fi
done
