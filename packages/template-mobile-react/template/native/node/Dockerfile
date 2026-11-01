# syntax=docker/dockerfile:1
# The Node.js of the mobile application (libnode and its headers), built from its sources for each system, Node.js
# 24.20.0 on all of them: Android and iOS from the patch recipe of digidem/nodejs-mobile, HarmonyOS from Node.js.
# The build directories are removed in the step making them (the build cache keeps no gigabytes of objects). Each target
# exports its files only (FROM scratch):
#   docker build --platform linux/amd64 --target harmony --output type=local,dest=<dir> .
#   docker build --platform linux/amd64 --target android --build-arg ABIS="arm64-v8a x86_64" --output type=local,dest=<dir> .
#   docker build --target ios --build-context ios-sdk=<iPhoneOS.sdk> --build-context ios-simulator-sdk=<iPhoneSimulator.sdk> \
#     --output type=local,dest=<dir> .

ARG NODE_VERSION=24.20.0
# The commit of the recipe releasing nodejs-mobile 24.20.0-0 (its upstream base: v24.20.0)
ARG RECIPE_COMMIT=7c55423d731f7fec83ac52ab158901ce20a57356
# The jobs of make: V8 takes over a gigabyte per job
ARG JOBS=6

# ---------------------------------------------------------------------------------------------------------------------
# HarmonyOS: the LLVM 19 of OpenHarmony (its toolchain and sysroot, Linux x86_64 only), a shared library (dlopened:
# PIE breaks its thread-local storage), the native thread-local storage (-fno-emulated-tls), named libnode.so (the
# addons link it by that name)
FROM node:22-bookworm AS harmony-build
ARG NODE_VERSION
ARG JOBS
ARG LLVM_URL=https://cidownload.openharmony.cn/version/Daily_Version/LLVM-19/20261101_061419/version-Daily_Version-LLVM-19-20261101_061419-LLVM-19.tar.gz
ARG LLVM_SHA256=764621be8b4bb86f14953421e4a812aaaba8265b682ac02a9cc7eda06e7fe0ff
RUN apt-get update && apt-get install -y --no-install-recommends patchelf && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o llvm.tar.gz "$LLVM_URL" \
 && echo "$LLVM_SHA256  llvm.tar.gz" | sha256sum -c - \
 && tar -xzf llvm.tar.gz llvm-linux-x86_64.tar.gz ohos-sysroot.tar.gz \
 && tar -xzf llvm-linux-x86_64.tar.gz && tar -xzf ohos-sysroot.tar.gz \
 && rm -f llvm.tar.gz llvm-linux-x86_64.tar.gz ohos-sysroot.tar.gz
RUN curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION.tar.xz" \
 && curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " node-v$NODE_VERSION.tar.xz\$" | sha256sum -c - \
 && tar -xJf "node-v$NODE_VERSION.tar.xz" && mv "node-v$NODE_VERSION" node && rm "node-v$NODE_VERSION.tar.xz"
RUN cd node \
 && export CC="/build/llvm/bin/aarch64-unknown-linux-ohos-clang -fno-emulated-tls" \
           CXX="/build/llvm/bin/aarch64-unknown-linux-ohos-clang++ -fno-emulated-tls" \
           AR=/build/llvm/bin/llvm-ar AR_target=/build/llvm/bin/llvm-ar AR_host=ar \
           CC_host=gcc CXX_host=g++ LINK_host=g++ CFLAGS=-DNDEBUG CXXFLAGS=-DNDEBUG \
 && ./configure --dest-cpu=arm64 --dest-os=openharmony --cross-compiling --openssl-no-asm --shared --prefix=/build/install > /tmp/configure.log 2>&1 || { tail -40 /tmp/configure.log; exit 1; }; \
    echo "Building libnode.so for HarmonyOS"; \
    make -j"$JOBS" > /tmp/make.log 2>&1 || { tail -60 /tmp/make.log; exit 1; }; \
    make install > /tmp/install.log 2>&1 || { tail -40 /tmp/install.log; exit 1; }; \
    cd /build && rm -rf node
RUN mkdir -p /export/libs/arm64-v8a \
 && /build/llvm/bin/llvm-strip -o /export/libs/arm64-v8a/libnode.so "$(ls /build/install/lib/libnode.so.* | head -1)" \
 && patchelf --set-soname libnode.so /export/libs/arm64-v8a/libnode.so \
 && cp -R /build/install/include /export/include

FROM scratch AS harmony
COPY --from=harmony-build /export/ /


# ---------------------------------------------------------------------------------------------------------------------
# The source tree of nodejs-mobile, made by its recipe (scripts/prepare.sh checks the tree it makes)
FROM node:22-bookworm AS recipe
ARG RECIPE_COMMIT
RUN git clone --filter=blob:none https://github.com/digidem/nodejs-mobile.git /recipe \
 && git -C /recipe checkout -q "$RECIPE_COMMIT" \
 && /recipe/scripts/prepare.sh /build/node && rm -rf /recipe

# ---------------------------------------------------------------------------------------------------------------------
# Android: the NDK r27d (Linux only: node's gyp archives thin archives and links its host tools with --start-group),
# libnode.so per ABI aligned to pages of 16 KB (Android 15 and later, Google Play), as the CI of the recipe builds it.
# The output of make goes to a file (BuildKit clips the output of a step at 2 MiB), its end printed when it fails
FROM node:22-bookworm AS android-build
ARG JOBS
ARG ABIS="arm64-v8a armeabi-v7a x86_64"
ARG NDK_SHA256=
RUN dpkg --add-architecture i386 && apt-get update \
 && apt-get install -y --no-install-recommends unzip rsync python3-setuptools gcc-multilib g++-multilib \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/ndk.zip https://dl.google.com/android/repository/android-ndk-r27d-linux.zip \
 && { [ -z "$NDK_SHA256" ] || echo "$NDK_SHA256  /tmp/ndk.zip" | sha256sum -c -; } \
 && unzip -q /tmp/ndk.zip -d /opt && rm /tmp/ndk.zip
COPY --from=recipe /build/node /build/node
RUN cd /build/node && for abi in $ABIS; do \
      case "$abi" in arm64-v8a) arch=arm64 ;; armeabi-v7a) arch=arm ;; x86_64) arch=x86_64 ;; *) echo "unknown ABI $abi" >&2; exit 1 ;; esac; \
      make clean >/dev/null 2>&1 || true; rm -rf android-toolchain; \
      export LDFLAGS=-Wl,-z,max-page-size=16384; \
      ./android-configure /opt/android-ndk-r27d 24 "$arch" > /tmp/configure.log 2>&1 || { tail -40 /tmp/configure.log; exit 1; }; \
      echo "Building libnode.so for $abi"; \
      make -j"$JOBS" > /tmp/make.log 2>&1 || { tail -60 /tmp/make.log; exit 1; }; \
      true \
      && mkdir -p "/export/libs/$abi" \
      && cp "$(ls out/Release/lib.target/libnode.so out/Release/obj.target/libnode.so 2>/dev/null | head -1)" "/export/libs/$abi/libnode.so" \
      || exit 1; \
    done \
 && bash tools/copy_libnode_headers.sh android \
 && cp common.gypi config.gypi out_android/libnode/include/node/ \
 && cp -R out_android/libnode/include /export/include \
 && cd / && rm -rf /build/node

FROM scratch AS android
COPY --from=android-build /export/ /

# ---------------------------------------------------------------------------------------------------------------------
# iOS: cross-compiled on Linux (natively on arm64) by LLVM 20 against the SDKs of the Xcode of the host, given as build
# contexts (Apple does not allow its SDKs to be redistributed), with the configuration of the recipe; the slices of the
# device and of the simulator (arm64) in one NodeMobile.xcframework. Node's gyp takes the host of an iOS build for a
# Mac: ios/bin holds the tools of Xcode it calls and compilers leaving out the flags of macOS for the host tools,
# ios/linux-host.py gives the host tools the sources of Linux
FROM node:22-bookworm AS ios-build
ARG JOBS
# The minimum of React Native 0.86 (libc++ of the SDKs of Xcode 26 and later supports iOS 15 and later)
ARG IOS_DEPLOYMENT_TARGET=15.1
RUN curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] http://apt.llvm.org/bookworm/ llvm-toolchain-bookworm-20 main" > /etc/apt/sources.list.d/llvm.list \
 && apt-get update && apt-get install -y --no-install-recommends clang-20 lld-20 llvm-20 rsync \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ios-sdk / /build/sdk/iPhoneOS.sdk
COPY --from=ios-simulator-sdk / /build/sdk/iPhoneSimulator.sdk
# LLVM 20 does not know the architecture arm64e.x1 the stubs of the SDK list (always next to arm64e)
RUN find /build/sdk -name '*.tbd' -exec sed -i 's/, arm64e\.x1-ios//g' {} +
COPY --from=recipe /build/node /build/node
COPY ios/ /build/ios/
# The scripts made executable here: the copies of the template do not keep the modes of the files
RUN chmod +x /build/ios/bin/* /build/ios/*.sh \
 && python3 /build/ios/linux-host.py /build/node \
 && export JOBS IOS_DEPLOYMENT_TARGET \
 && /build/ios/build-slice.sh device && /build/ios/build-slice.sh simulator && /build/ios/make-framework.sh \
 && rm -rf /build/node /build/slices

FROM scratch AS ios
COPY --from=ios-build /export/ /
