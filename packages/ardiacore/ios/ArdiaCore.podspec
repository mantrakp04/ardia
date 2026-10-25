engine_public = File.expand_path('../../../engine/ardiacore/src/ardia/core/public', __dir__)

Pod::Spec.new do |s|
  s.name           = 'ArdiaCore'
  s.version        = '0.0.0'
  s.summary        = 'Ardia on ArdiaCore (our own Chromium layer) for React Native macOS'
  s.author         = ''
  s.homepage       = 'https://github.com/ardia'
  s.license        = 'Apache-2.0'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WebKit'
  s.source_files   = '*.{h,mm,swift}'
  s.public_header_files = 'ArdiaCoreHost.h', 'ArdiaCoreWebView.h', 'ArdiaCoreTabStrip.h', 'ArdiaCoreEngineBridge.h', 'ArdiaCoreServices.h', 'ACSwipe.h', 'ACChromeWindow.h'
  s.resources      = 'page_script.js'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => "\"#{engine_public}\"",
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }
end
