export CB="${AC_CHROMIUM_BUILD:-$HOME/chromium-build}"
_ac_repo="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)"
[[ -f "$_ac_repo/engine/patches/series" ]] || _ac_repo="$HOME/Documents/ardia"
export AC_REPO="${AC_REPO:-$_ac_repo}"
unset _ac_repo
export DEPOT_TOOLS_UPDATE=0
export PATH="$CB/depot_tools:$PATH"
export CHROMIUM_VERSION=156.0.8078.47
export HELIUM_TAG=0.20.1
export HELIUM_MACOS_TAG=0.20.1.1
export HELIUM_DIR="$CB/helium"
export HELIUM_MACOS_DIR="$CB/helium-macos"
export HELIUM_LINUX_TAG=0.20.1.1
export HELIUM_LINUX_DIR="$CB/helium-linux"
_ac_target_config=$(python3 "$(dirname "${BASH_SOURCE[0]:-$0}")/target_config.py" --shell) || return $?
eval "$_ac_target_config"
unset _ac_target_config
if [[ "$AC_TARGET_OS" == linux ]]; then
  export CHROMIUM_SRC="${CHROMIUM_SRC:-$CB/chromium_git/chromium/src}"
fi
if [[ "$AC_TARGET_OS" == mac && "$AC_TARGET_CPU" == arm64 ]]; then
  export AC_SERIES_BASE="${AC_SERIES_BASE:-$CB/series-base}"
else
  export AC_SERIES_BASE="${AC_SERIES_BASE:-$CB/series-base-$AC_TARGET_OS-$AC_TARGET_CPU}"
fi
lowprio() {
  if [[ "$(uname -s)" == Darwin ]]; then taskpolicy -b nice -n 19 "$@"; else nice -n 19 "$@"; fi
}
lowprio_net() {
  if [[ "$(uname -s)" == Darwin ]]; then taskpolicy -c utility -d throttle nice -n 19 "$@"; else nice -n 19 "$@"; fi
}
export DEPOT_TOOLS_METRICS=0
