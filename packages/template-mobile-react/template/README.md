# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) mobile application for Android, iOS and HarmonyOS, made with [React
Native](https://reactnative.dev) and, on HarmonyOS, [RNOH](https://gitcode.com/openharmony-sig/ohos_react_native) (React
Native for OpenHarmony, `@react-native-oh/react-native-harmony`). The application runs in a Node.js embedded in the
mobile application: a libnode built from the sources of Node.js by
[lakutata/libnode](https://github.com/lakutata/libnode) and downloaded from its releases.

The root of the project is the application of React Native: its entry `index.js`, which registers the component `App`
of the user interface, `app.json`, the configurations of Metro and Babel, and the native projects `android`, `ios` and
`harmony`, opened in Android Studio, Xcode (`ios/App.xcworkspace`, once the pods are installed) and DevEco Studio. Its
parts are the packages of a workspace:

- `packages/app`: the Node.js side, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  user interface through the native module (`reactNativeServiceEntrypoint`);
- `packages/ui`: the user interface of React Native, the same on the three systems (`src/App.tsx`, its component
  `App`);
- `packages/ipc`: what connects the user interface to the Node.js side. `ipc` (`src/ipc.ts`, imported from the package
  `ipc`) invokes the actions of the application, `ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events
  it pushes, `ipc.on('greeted', listener)` (which returns the function removing the listener); `native` is the native
  module, in C++ shared by the three systems (it starts Node.js in a thread of its own and talks to it over a socket),
  and `native/node/out` the libnode of each system once downloaded.

```bash
npm run node:android      # download the libnode of Android (npm run android does it the first time)
npm run node:ios          # the one of iOS
npm run node:harmony      # the one of HarmonyOS
npm start                 # Metro, which gives the debug builds their user interface (Fast Refresh)
npm run android           # build the application and run it on the emulator or the device of Android running
npm run ios               # build it and run it on a simulator of iOS (macOS, Xcode)
npm run harmony           # build it and run it on the emulator or the device of HarmonyOS (DevEco Studio)
npm run deploy:android    # put the Node.js side into the application installed, and start it again
npm run deploy:ios        # the same on the simulator of iOS
npm run deploy:harmony    # the same on HarmonyOS
npm test                  # build the packages and run their tests (the actions of the application, without a device)
npm run version:patch     # give the packages their next version
```

A new action: a method of a controller of `packages/app/src/controllers` decorated by
`@ServiceAction({cmd: 'name'}, DTO)`, invoked by the user interface with `ipc.invoke({cmd: 'name', ...input})`: its
input is validated by its DTO, its result is given back, its errors are thrown in the user interface (with their
`errno`). The user interface is a client of the application: its id is the `clientId` of the context of its requests,
which the entrypoint pushes events to, `this.entrypoint.notify(clientId, 'event', ...args)`, or to every client,
`this.entrypoint.broadcast('event', ...args)`.

`npm run dev -w app` runs the application on the computer and serves its actions over HTTP on the port `DEV_PORT` (9000
by default), for tools such as Postman or curl: `POST /` with `{"cmd": "greet", "name": "you"}` answers the response of
the action, with the id of the client in the `id` header; `GET /events?id=<client>` streams the events pushed to the
client (Server-Sent Events).

## The id of the application

The id of the application is `{$APP_BUNDLE_ID}` (`lakutata create --bundle-id` sets it). It is the `applicationId` of
`android/app/build.gradle`, the `PRODUCT_BUNDLE_IDENTIFIER` of `ios/App.xcodeproj/project.pbxproj` and the `bundleName`
of `harmony/AppScope/app.json5`: change it in all three places. The package of the Kotlin code (`dev.lakutata.mobile`)
and the names of the projects (`App`) are not the id and can stay as they are.

## The development

Android needs the Android SDK (`ANDROID_HOME`, with its NDK and an emulator, as Android Studio installs them) and a JDK
that Gradle runs on (`JAVA_HOME`, see [Problems](#problems)); iOS needs Xcode and CocoaPods on macOS; HarmonyOS needs
DevEco Studio (its emulator, or a device).

1. The libnode of the system is downloaded the first time `npm run android` (or `ios`, `harmony`) runs, or beforehand by
   `npm run node:android` (or `node:ios`, `node:harmony`): from the releases of lakutata/libnode, checked with their
   checksums, kept in the cache of lakutata and put into `packages/ipc/native/node/out/<platform>`, which the native
   projects build against. `LAKUTATA_LIBNODE_MIRROR` gives a mirror of the releases
   (`<mirror>/v<version>/libnode_<platform>_<arch>.tar.gz`), and `LAKUTATA_MOBILE_NODE_DIR` a libnode of your own, built
   with the repository of lakutata/libnode (a directory per system: `android`, `ios`, `harmony`).
2. Start Metro: `npm start`.
3. Run the application: `npm run android` (or `ios`, `harmony`) builds the packages, makes the Node.js project of the
   application (`lakutata mobile stage`), builds the debug application, installs it and starts it
   (`lakutata mobile run`). The user interface comes from Metro: its changes show at once (Fast Refresh).
4. Change the Node.js side: `npm run deploy:android` (or `deploy:ios`, `deploy:harmony`) builds it, puts it into the
   installed application and starts the application again, without installing it again;
   `npm run deploy:android -- --watch` does so whenever `packages/app` changes.

When Node.js ends (`process.exit()`, an uncaught exception), the mobile application keeps running: `ipc` rejects the
actions in progress and emits `exit` with the exit code, and `ipc.restart()` starts Node.js again (the example shows a
button for it).

## The Node.js of the application

The libnode of the three systems is Node.js 24.20.0, the release `v24.20.0` of lakutata/libnode: Android and iOS from
the patches of [nodejs-mobile](https://github.com/digidem/nodejs-mobile), HarmonyOS from Node.js. `lakutata mobile
stage` bundles the application for it into the place where the native project takes it:
`android/app/src/main/assets/nodejs` (copied into the files of the application at its first launch and after each
update), `ios/nodejs` (put into the bundle of the application by its build) or
`harmony/entry/src/main/resources/resfile/nodejs` (run from the resources of the HAP). These are left out of git, with
`packages/ipc/native/node/out`.

V8 runs without JIT on iOS and HarmonyOS. On iOS, WebAssembly comes from the polyfill that nodejs-mobile bundles, so
`fetch()` works as on Android; HarmonyOS has none, and `fetch()` is removed there (`node:http` and `node:https` work).
The temporary directory of the application is `os.tmpdir()` on the three systems.

## Native addons

`lakutata mobile stage` builds the native addons of the dependencies from their sources (their `binding.gyp`) against
the libnode of the system: for Android with the NDK, for each architecture of the libnode; for iOS on macOS with Xcode,
as frameworks in `ios/NodeAddons`, which the build of the application embeds and signs; for HarmonyOS with the native
SDK of DevEco Studio, as libraries of the HAP (`harmony/entry/libs/arm64-v8a`). The first build of a package takes a
while; the builds are kept in the cache of lakutata, and `npm run deploy:<platform>` builds for the device only.

## The packaging

The release builds come from the native projects: `cd android && ./gradlew bundleRelease` (the release bundle of
Android, signed with the keystore `android/app/build.gradle` names: the debug keystore in the template, so give it your
release keystore first), an archive of `ios/App.xcworkspace` in Xcode (Product, Archive, with your team in Signing &
Capabilities), and `assembleApp` of DevEco Studio for HarmonyOS (signed with the profile of the application). Make the
Node.js project first (`npm run stage:<platform>`); the release builds bundle the user interface themselves, compiled by
Hermes on Android and iOS.

## Problems

- **Gradle refuses the JDK**: the JDK of `JAVA_HOME` (or of the `PATH`) is newer than the Gradle of the project (9.3)
  runs on, as Java 27 is. Give `JAVA_HOME` an older one, such as JDK 21.
- **The application of HarmonyOS shows a blank screen, or `npm run harmony` stops with
  `[Fail]TCP Port listen failed at 8081`**: the emulator started from its snapshot, which keeps on the port the listener
  an earlier forward of Metro left there. Start the emulator again with a cold boot (Cold Boot in the Device Manager of
  DevEco Studio).
- **The emulator of HarmonyOS does not start (ErrorCode 00801002)**: it needs 12 GB free on the disk.
