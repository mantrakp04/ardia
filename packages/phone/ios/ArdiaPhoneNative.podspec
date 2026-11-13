require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ArdiaPhoneNative'
  s.version        = '0.0.0'
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'Apache-2.0'
  s.author         = 'Ardia'
  s.homepage       = 'https://ardia.dev'
  s.platforms      = { :ios => '27.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "${SYMROOT}/${CONFIGURATION}${EFFECTIVE_PLATFORM_NAME}"',
  }

  s.source_files = '*.swift'
end
