export CB="${AC_CHROMIUM_BUILD:-$HOME/chromium-build}"
_ac_repo="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)"
[[ -f "$_ac_repo/engine/patches/series" ]] || _ac_repo="$HOME/Documents/ardia"
export AC_REPO="${AC_REPO:-$_ac_repo}"
unset _ac_repo
export DEPOT_TOOLS_UPDATE=0
export PATH="$CB/depot_tools:$PATH"
export CHROMIUM_VERSION=155.0.8059.84
export HELIUM_TAG=0.19.4
export HELIUM_MACOS_TAG=0.19.4.1
export HELIUM_DIR="$CB/helium"
export HELIUM_MACOS_DIR="$CB/helium-macos"
export AC_TARGET_CPU="${AC_TARGET_CPU:-arm64}"
case "$AC_TARGET_CPU" in arm64 | x64) ;; *) echo "env.sh: AC_TARGET_CPU is arm64 or x64, not $AC_TARGET_CPU" >&2; return 64 2>/dev/null || exit 64 ;; esac
export GN_OUT_CONFIGS="Release_GN_$AC_TARGET_CPU"
if [[ "${AC_FULL_PRIORITY:-}" == 1 ]]; then
  lowprio() { "$@"; }
  lowprio_net() { "$@"; }
else
  lowprio() { taskpolicy -b nice -n 19 "$@"; }
  lowprio_net() { taskpolicy -c utility -d throttle nice -n 19 "$@"; }
fi
export DEPOT_TOOLS_METRICS=0
