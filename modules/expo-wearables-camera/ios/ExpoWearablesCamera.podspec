require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoWearablesCamera'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/ashrafshaik543/expo-wearables-camera' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.vendored_frameworks = 'Frameworks/MWDATCore.xcframework', 'Frameworks/MWDATCamera.xcframework'
  s.preserve_paths = 'Frameworks/**'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]' => '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks/MWDATCore.xcframework/ios-arm64" "${PODS_TARGET_SRCROOT}/Frameworks/MWDATCamera.xcframework/ios-arm64"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*]' => '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks/MWDATCore.xcframework/ios-arm64_x86_64-simulator" "${PODS_TARGET_SRCROOT}/Frameworks/MWDATCamera.xcframework/ios-arm64_x86_64-simulator"',
  }

  s.xcconfig = {
    'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]' => '$(inherited) "${PODS_ROOT}/../../modules/expo-wearables-camera/ios/Frameworks/MWDATCore.xcframework/ios-arm64" "${PODS_ROOT}/../../modules/expo-wearables-camera/ios/Frameworks/MWDATCamera.xcframework/ios-arm64"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*]' => '$(inherited) "${PODS_ROOT}/../../modules/expo-wearables-camera/ios/Frameworks/MWDATCore.xcframework/ios-arm64_x86_64-simulator" "${PODS_ROOT}/../../modules/expo-wearables-camera/ios/Frameworks/MWDATCamera.xcframework/ios-arm64_x86_64-simulator"',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = "Frameworks/**/*"
end
