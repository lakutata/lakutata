#!/bin/sh
# NodeMobile.xcframework and the headers in /export from the archives of both slices (/build/slices/<slice>), linked as
# the Xcode project of the recipe (tools/ios-framework) links them: node_start (tools/ios-framework/NodeMobile) and every
# member of the archives (-all_load), CoreFoundation, Security and libc++; a dynamic framework named
# @rpath/NodeMobile.framework/NodeMobile, its Info.plist with the keys App Store Connect checks
set -e
NODE=/build/node
OUT=/export
VERSION=$(sed -n 's/^#define NODE_\(MAJOR\|MINOR\|PATCH\)_VERSION \([0-9]*\)/\2/p' $NODE/src/node_version.h | paste -sd.)
mkdir -p "$OUT/NodeMobile.xcframework"
for slice in device simulator; do
  case "$slice" in
    device) triple=arm64-apple-ios$IOS_DEPLOYMENT_TARGET; sdk=iPhoneOS; id=ios-arm64 ;;
    simulator) triple=arm64-apple-ios$IOS_DEPLOYMENT_TARGET-simulator; sdk=iPhoneSimulator; id=ios-arm64-simulator ;;
  esac
  fw="$OUT/NodeMobile.xcframework/$id/NodeMobile.framework"
  mkdir -p "$fw/Headers" "$fw/Modules"
  archives=""
  for lib in $(cat /build/ios/libraries); do archives="$archives /build/slices/$slice/$lib.a"; done
  clang++-20 -target $triple -isysroot /build/sdk/$sdk.sdk -std=gnu++17 -O2 -I $NODE/tools/ios-framework/NodeMobile \
    -x c++ -c $NODE/tools/ios-framework/NodeMobile/NodeMobile.cpp -o /tmp/NodeMobile-$slice.o
  clang++-20 -target $triple -isysroot /build/sdk/$sdk.sdk -fuse-ld=lld -dynamiclib \
    -install_name @rpath/NodeMobile.framework/NodeMobile -compatibility_version 1 -current_version 1 \
    /tmp/NodeMobile-$slice.o -Wl,-all_load $archives -framework CoreFoundation -framework Security -lc++ \
    -Wl,-dead_strip -Wl,-x -o "$fw/NodeMobile"
  cp $NODE/tools/ios-framework/NodeMobile/NodeMobile.h "$fw/Headers/"
  printf 'framework module NodeMobile {\n  umbrella header "NodeMobile.h"\n  export *\n  module * { export * }\n}\n' > "$fw/Modules/module.modulemap"
  cat > "$fw/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>NodeMobile</string>
	<key>CFBundleIdentifier</key>
	<string>org.nodejs.mobile.NodeMobile</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>NodeMobile</string>
	<key>CFBundlePackageType</key>
	<string>FMWK</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>$sdk</string>
	</array>
	<key>MinimumOSVersion</key>
	<string>$IOS_DEPLOYMENT_TARGET</string>
	<key>UIDeviceFamily</key>
	<array>
		<integer>1</integer>
		<integer>2</integer>
	</array>
	<key>NSHumanReadableCopyright</key>
	<string>Copyright Node.js contributors. Modifications copyright (c) Janea Systems, Inc. MIT license.</string>
</dict>
</plist>
PLIST
done
cat > "$OUT/NodeMobile.xcframework/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AvailableLibraries</key>
	<array>
		<dict>
			<key>BinaryPath</key>
			<string>NodeMobile.framework/NodeMobile</string>
			<key>LibraryIdentifier</key>
			<string>ios-arm64</string>
			<key>LibraryPath</key>
			<string>NodeMobile.framework</string>
			<key>SupportedArchitectures</key>
			<array>
				<string>arm64</string>
			</array>
			<key>SupportedPlatform</key>
			<string>ios</string>
		</dict>
		<dict>
			<key>BinaryPath</key>
			<string>NodeMobile.framework/NodeMobile</string>
			<key>LibraryIdentifier</key>
			<string>ios-arm64-simulator</string>
			<key>LibraryPath</key>
			<string>NodeMobile.framework</string>
			<key>SupportedArchitectures</key>
			<array>
				<string>arm64</string>
			</array>
			<key>SupportedPlatform</key>
			<string>ios</string>
			<key>SupportedPlatformVariant</key>
			<string>simulator</string>
		</dict>
	</array>
	<key>CFBundlePackageType</key>
	<string>XFWK</string>
	<key>XCFrameworkFormatVersion</key>
	<string>1.0</string>
</dict>
</plist>
PLIST
cd $NODE && bash tools/copy_libnode_headers.sh ios > /dev/null && cp common.gypi config.gypi out_ios/libnode/include/node/ && cp -R out_ios/libnode/include "$OUT/include"
