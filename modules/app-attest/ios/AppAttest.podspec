Pod::Spec.new do |s|
  s.name           = 'AppAttest'
  s.version        = '1.0.0'
  s.summary        = 'FetchIt device attestation (Apple App Attest / DCAppAttestService).'
  s.description    = 'Local Expo native module wrapping DCAppAttestService for iOS device attestation.'
  s.author         = 'FetchIt'
  s.homepage       = 'https://fetchit.ai'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # DeviceCheck is a system framework (DCAppAttestService lives here).
  s.frameworks = 'DeviceCheck'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
