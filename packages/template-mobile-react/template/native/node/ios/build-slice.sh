#!/bin/sh
# One slice of the iOS libnode (device or simulator) with the configuration of the recipe (tools/ios_framework_prepare.sh):
# configure, make, the stub compiler; the archives the framework links kept in /build/slices/<slice>, the build
# directory removed
set -e
slice="$1"
export PATH=/build/ios/bin:$PATH
cd /build/node
case "$slice" in
  device) triple=arm64-apple-ios$IOS_DEPLOYMENT_TARGET; extra= ;;
  simulator) triple=arm64-apple-ios$IOS_DEPLOYMENT_TARGET-simulator; extra=--ios-simulator ;;
  *) echo "unknown slice $slice" >&2; exit 1 ;;
esac
export CC_target="/build/ios/bin/target-clang -target $triple" CXX_target="/build/ios/bin/target-clang++ -target $triple"
export LINK_target="/build/ios/bin/target-clang++ -target $triple -fuse-ld=lld"
export CC_host=/build/ios/bin/host-clang CXX_host=/build/ios/bin/host-clang++ LINK_host=/build/ios/bin/host-clang++
export CC=clang-20 CXX=clang++-20
export GYP_DEFINES="target_arch=arm64 host_os=linux target_os=ios v8_enable_turbofan=0"
python3 ./configure --dest-os=ios --dest-cpu=arm64 --with-intl=small-icu --cross-compiling --enable-static --openssl-no-asm \
  --v8-options=--jitless --v8-lite-mode --v8-disable-maglev --without-node-code-cache --without-node-snapshot $extra \
  > /tmp/configure-$slice.log 2>&1 || { tail -40 /tmp/configure-$slice.log; exit 1; }
echo "Building libnode for iOS ($slice)"
make -C out BUILDTYPE=Release -j"$JOBS" > /tmp/make-$slice.log 2>&1 || { tail -60 /tmp/make-$slice.log; exit 1; }
make -C out BUILDTYPE=Release -j"$JOBS" v8_compiler >> /tmp/make-$slice.log 2>&1 || { tail -60 /tmp/make-$slice.log; exit 1; }
mkdir -p /build/slices/$slice
for lib in $(cat /build/ios/libraries); do
  cp out/Release/$lib.a /build/slices/$slice/
done
rm -rf out
