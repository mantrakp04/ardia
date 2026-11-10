source "$AC_MAC_BUILD_DIR/gn_defines.sh"
_win_drop=(is_official_build chrome_pgo_phase target_cpu enable_cdm_host_verification)
_win_add=(
  'target_os="win"'
  "target_cpu=\"${WIN_CPU:-x64}\""
  is_official_build=false
  chrome_pgo_phase=0
  use_thin_lto=false
  enable_swiftshader=false
)
_win_args=()
for _arg in "${_gn_args[@]}"; do
  _name="${_arg%%=*}"
  _keep=1
  for _drop in "${_win_drop[@]}"; do
    [[ "$_name" == "$_drop" ]] && _keep=0
  done
  [[ $_keep == 1 ]] && _win_args+=("$_arg")
done
_gn_args=("${_win_args[@]}" "${_win_add[@]}")
unset _win_args _win_drop _win_add _arg _name _keep _drop
export GN_DEFINES="${_gn_args[*]}"
