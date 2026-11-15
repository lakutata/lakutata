# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) mobile application for Android, iOS and HarmonyOS, made with
[React Native](https://reactnative.dev) and, on HarmonyOS, [RNOH](https://gitcode.com/openharmony-sig/ohos_react_native)
(React Native for OpenHarmony, `@react-native-oh/react-native-harmony`). The application runs in a Node.js embedded in
the mobile application: a libnode built from the Node.js sources by
[lakutata/libnode](https://github.com/lakutata/libnode) and downloaded from its releases.

The root of the project is the React Native application: its entry `index.js`, which registers the component `App` of
the user interface, `app.json`, the Metro and Babel configurations, and the native projects `android`, `ios` and
`harmony`, which open in Android Studio, Xcode (`ios/App.xcworkspace`, once the pods are installed) and DevEco Studio.
Its parts are the packages of a workspace:

- `packages/app`: the Node.js side, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  user interface through the native module (`reactNativeServiceEntrypoint`).
- `packages/ui`: the React Native user interface, the same on the three systems (`src/App.tsx`, its component `App`),
  which keeps its screen within the safe area of the device (`react-native-safe-area-context`, and its port
  `@react-native-ohos/react-native-safe-area-context` on HarmonyOS).
- `packages/ipc`: the connection between the user interface and the Node.js side. `ipc` (`src/ipc.ts`, imported from the
  package `ipc`) invokes the actions of the application, as in `ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to
  the events the application pushes, as in `ipc.on('greeted', listener)`, which returns a function that removes the
  listener. `native` is the native module, written in C++ shared by the three systems: it starts Node.js in a thread of
  its own and communicates with it over a socket. `native/node/out` holds the libnode of each system once it is
  downloaded.

```bash
npm run node:android      # download the libnode for Android (npm run android does so the first time)
npm run node:ios          # download the libnode for iOS
npm run node:harmony      # download the libnode for HarmonyOS
npm start                 # start Metro, which serves the user interface to the debug builds (Fast Refresh)
npm run android           # build the application and run it on the running Android emulator or device
npm run ios               # build it and run it on an iOS simulator (macOS, Xcode)
npm run harmony           # build it and run it on the HarmonyOS emulator or device (DevEco Studio)
npm run deploy:android    # put the Node.js side into the installed application and restart it
npm run deploy:ios        # the same on the iOS simulator
npm run deploy:harmony    # the same on HarmonyOS
npm test                  # build the packages and run their tests (the actions of the application, without a device)
npm run version:patch     # give every package its next patch version
```

To add an action, write a method in a controller of `packages/app/src/controllers` and decorate it with
`@ServiceAction({cmd: 'name'}, DTO)`. The user interface invokes it with `ipc.invoke({cmd: 'name', ...input})`: the
input is validated by the DTO, the result is returned, and errors are thrown in the user interface with their `errno`.
The user interface is a client of the application. Its id is the `clientId` of its request context, and the entrypoint
pushes events to it with `this.entrypoint.notify(clientId, 'event', ...args)`, or to every client with
`this.entrypoint.broadcast('event', ...args)`.

`npm run dev -w app` runs the application on the computer and serves its actions over HTTP on port `DEV_PORT` (9000 by
default), for tools such as Postman or curl. `POST /` with `{"cmd": "greet", "name": "you"}` returns the response of the
action; the request carries the client id in its `id` header. `GET /events?id=<client>` streams the events pushed to
that client (Server-Sent Events).

## The application id

The id of the application is `{$APP_BUNDLE_ID}`, set by `lakutata create --bundle-id`. It is the `applicationId` in
`android/app/build.gradle`, the `PRODUCT_BUNDLE_IDENTIFIER` in `ios/App.xcodeproj/project.pbxproj` and the `bundleName`
in `harmony/AppScope/app.json5`: to change it, change it in all three places. The package of the Kotlin code
(`dev.lakutata.mobile`), the name of the Android and iOS projects and the name of the React Native component (`App`) are
not the id and can stay as they are.

## The development workflow

Android needs the Android SDK (`ANDROID_HOME`, with its NDK and an emulator, as Android Studio installs them) and a JDK
that Gradle runs on (`JAVA_HOME`, see [Troubleshooting](#troubleshooting)); iOS needs Xcode and CocoaPods on macOS;
HarmonyOS needs DevEco Studio (with its emulator, or a device).

1. The libnode for the system is downloaded the first time `npm run android` (or `ios`, `harmony`) runs, or beforehand
   with `npm run node:android` (or `node:ios`, `node:harmony`). It comes from the releases of lakutata/libnode, is
   checked against their checksums, kept in the lakutata cache and placed in `packages/ipc/native/node/out/<platform>`,
   which the native projects build against. `LAKUTATA_LIBNODE_MIRROR` sets a mirror of the releases
   (`<mirror>/v<version>/libnode_<platform>_<arch>.tar.gz` and `<mirror>/v<version>/SHA256SUMS`), and
   `LAKUTATA_MOBILE_NODE_DIR` a libnode of your own, built with the lakutata/libnode repository (one directory per
   system: `android`, `ios`, `harmony`).
2. Start Metro: `npm start`.
3. Run the application: `npm run android` (or `ios`, `harmony`) builds the packages, makes the Node.js project of the
   application (`lakutata mobile stage`), builds the debug application, installs it and starts it
   (`lakutata mobile run`). The user interface is served by Metro, so its changes appear at once (Fast Refresh).
4. Change the Node.js side: `npm run deploy:android` (or `deploy:ios`, `deploy:harmony`) builds it, puts it into the
   installed application and restarts the application without reinstalling it; `npm run deploy:android -- --watch` does
   so whenever `packages/app` changes. On HarmonyOS, native addons are libraries of the application, which only
   `npm run harmony` installs.

When Node.js ends (through `process.exit()`, or because the launch of the application fails; an exception left uncaught
after the launch is only logged), the mobile application keeps running: `ipc` rejects the actions in progress and emits
`exit` with the exit code, and `ipc.restart()` starts Node.js again (the example shows a button for this).

## The embedded Node.js

The libnode of the three systems is Node.js 24.20.0, from the release `v24.20.0` of lakutata/libnode: for Android and
iOS it is built with the patches of [nodejs-mobile](https://github.com/digidem/nodejs-mobile), and for HarmonyOS from
Node.js itself. `lakutata mobile stage` bundles the application for it into the place where the native project picks it
up: `android/app/src/main/assets/nodejs` (copied into the files of the application on its first launch and after each
update), `ios/nodejs` (copied into the bundle of the application by its build) or
`harmony/entry/src/main/resources/resfile/nodejs` (run from the resources of the HAP). These directories, like
`packages/ipc/native/node/out`, are excluded from git.

V8 runs without a JIT on iOS and HarmonyOS. On iOS, WebAssembly is provided by the polyfill bundled with nodejs-mobile,
so `fetch()` works as it does on Android; HarmonyOS has no WebAssembly, so `fetch()` is removed there (`node:http` and
`node:https` work). On the three systems, the temporary directory of the application, `os.tmpdir()`, is its cache, which
the system may empty. Files that must persist go into its data directory, which `packages/app/src/App.ts` declares as
the alias `@data` for each system: the `files` directory of the application on Android, `Library/Application Support` on
iOS, `/data/storage/el2/base/files` on HarmonyOS and `packages/app/data` on the computer. Once the alias is declared,
`path.resolve('@data/app.sqlite')` returns the path of a file there, in the options function that `App.ts` passes to
`run()`.

## The native addons

`lakutata mobile stage` builds the native addons of the dependencies from their sources (their `binding.gyp`) against
the libnode of the system: for Android with the NDK, for each architecture of the libnode; for iOS on macOS with Xcode,
as frameworks in `ios/NodeAddons`, which the build of the application embeds and signs; and for HarmonyOS with the
native SDK of DevEco Studio, as libraries of the HAP (`harmony/entry/libs/arm64-v8a`). The builds are kept in the
lakutata cache, and `npm run deploy:<platform>` builds only for the device it deploys to.

## The release builds

Release builds are made from the native projects: `cd android && ./gradlew bundleRelease` for Android (the release
bundle, signed with the keystore named in `android/app/build.gradle`; the template names the debug keystore, so set your
release keystore first), an archive of `ios/App.xcworkspace` in Xcode for iOS (Product > Archive, with your team set
under Signing & Capabilities), and `assembleApp` in DevEco Studio for HarmonyOS (signed with the profile of the
application). Make the Node.js project first (`npm run stage:<platform>`). The release builds for Android and iOS bundle
the user interface themselves, compiled by Hermes. The HarmonyOS application loads it from
`harmony/entry/src/main/resources/rawfile/bundle.harmony.js`, which `npm run harmony` writes
(`react-native bundle-harmony --dev false --bundle-output harmony/entry/src/main/resources/rawfile/bundle.harmony.js`).

## Troubleshooting

- **Gradle refuses the JDK**: the JDK of `JAVA_HOME` (or of the `PATH`) is newer than the versions that the project's
  Gradle (9.3) runs on. Set `JAVA_HOME` to an older JDK, such as JDK 21.
- **The HarmonyOS application shows a blank screen, or `npm run harmony` stops with
  `[Fail]TCP Port listen failed at 8081`**: the emulator was started from its snapshot, which keeps a listener that an
  earlier Metro forward left on the port. Restart the emulator with a cold boot (Cold Boot in the Device Manager of
  DevEco Studio).
- **The HarmonyOS emulator does not start (ErrorCode 00801002)**: it needs 12 GB of free disk space.
