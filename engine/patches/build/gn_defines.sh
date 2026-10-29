_gn_args=(
  is_official_build=true
  chrome_pgo_phase=2
  is_debug=false
  dcheck_always_on=false
  symbol_level=0 blink_symbol_level=0 v8_symbol_level=0
  is_component_build=false
  forbid_non_component_debug_builds=false
  "target_cpu=\"$AC_TARGET_CPU\""
  "target_os=\"$AC_TARGET_OS\""
  proprietary_codecs=true
  'ffmpeg_branding="Chrome"'
  enable_mse_mpeg2ts_stream_parser=true
  enable_widevine=true
  'alternate_cdm_storage_id_key="968b476909da4373b08903c28e859454"'
  treat_warnings_as_errors=false
  fatal_linker_warnings=false
  clang_use_chrome_plugins=false
  enable_precompiled_headers=false
  safe_browsing_mode=0
  enable_reporting=false
  disable_fieldtrial_testing_config=true
  enable_hangout_services_extension=false
  enable_remoting=false
  exclude_unwind_tables=true
  'google_api_key=""'
  'google_default_client_id=""'
  'google_default_client_secret=""'
  use_official_google_api_keys=false
  use_unofficial_version_number=false
  v8_drumbrake_bounds_checks=true
  enable_iterator_debugging=false
  enable_updater=false
  enable_background_mode=false
  enable_downgrade_processing=false
  enable_resource_allowlist_generation=false
  optimize_webui=true
  'branding_file_path="//chrome/app/theme/ardia/BRANDING"'
)
if [[ "$AC_TARGET_OS" == linux ]]; then
  _gn_args+=(enable_cdm_host_verification=false enable_cdm_storage_id=false enable_rlz=false use_vaapi=true rtc_use_pipewire=true use_sysroot=true is_clang=true use_kerberos=false use_system_libffi=false use_siso=true blink_enable_generated_code_formatting=false)
else
  _gn_args+=(enable_cdm_host_verification=true enable_cdm_storage_id=true enable_rlz=true)
fi
export GN_DEFINES="${_gn_args[*]}"
