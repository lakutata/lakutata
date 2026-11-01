# The Node.js of the application on iOS: its host and its TurboModule (the C++ shared with Android and HarmonyOS), the
# lifecycle helper of the scene delegate, and the libnode of iOS built by node/Dockerfile (npm run node:ios)
Pod::Spec.new do |s|
  s.name = 'LakutataNodeHost'
  s.version = '1.0.0'
  s.summary = 'The Node.js of the application: its host and its TurboModule'
  s.homepage = 'https://lakutata.com'
  s.license = 'MIT'
  s.authors = 'lakutata'
  s.platforms = {:ios => '15.1'}
  s.source = {:path => '.'}
  s.source_files = '*.{h,cpp}', 'ios/*.{h,mm}'
  s.public_header_files = 'ios/*.h'
  s.vendored_frameworks = 'node/out/ios/NodeMobile.xcframework'
  s.pod_target_xcconfig = {'DEFINES_MODULE' => 'YES', 'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/node/out/ios/include/node"'}
  install_modules_dependencies(s)
end
