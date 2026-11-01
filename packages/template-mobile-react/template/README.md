# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) mobile application for Android, iOS and HarmonyOS, made with
[React Native](https://reactnative.dev) and, on HarmonyOS, [RNOH](https://gitcode.com/openharmony-sig/ohos_react_native)
(React Native for OpenHarmony, `@react-native-oh/react-native-harmony`). The application runs in a Node.js embedded in
the mobile application: a libnode built from the sources of Node.js by the Dockerfile of the project. The project is a
workspace:

- `packages/app`: the Node.js side, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  user interface through the native module (`reactNativeServiceEntrypoint`);
- the root: the user interface of React Native (`App.tsx`). `ipc` (`src/ipc.ts`) invokes the actions of the
  application, `ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events it pushes,
  `ipc.on('greeted', listener)` (which returns the function removing the listener);
- `native`: the native module, in C++ shared by the three systems (it starts Node.js in a thread of its own and talks to
  it over a socket), and `native/node`, the Dockerfile building libnode;
- `android`, `ios` and `harmony`: the native projects, opened in Android Studio, Xcode (`ios/App.xcworkspace`, once the
  pods are installed) and DevEco Studio.

```bash
npm run node:android      # build the libnode of Android once (Docker, about an hour and a half per architecture)
npm run node:ios          # the one of iOS (Docker on macOS, against the SDKs of Xcode)
npm run node:harmony      # the one of HarmonyOS (Docker)
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

Android needs Android Studio (its SDK in `ANDROID_HOME`, its NDK, an emulator, and a JDK such as the one it ships with);
iOS needs Xcode and CocoaPods on macOS; HarmonyOS needs DevEco Studio (its emulator, or a device). libnode is built with
Docker.

1. Build the libnode of the system once: `npm run node:android` (or `node:ios`, `node:harmony`). It is kept in the
   cache of lakutata and exported into `native/node/out/<platform>`, which the native projects build against; it is
   built again only when the Dockerfile changes.
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

The libnode of the three systems is Node.js 24.20.0 (`ARG NODE_VERSION` of `native/node/Dockerfile`): Android and iOS
from the patches of [nodejs-mobile](https://github.com/digidem/nodejs-mobile) (`RECIPE_COMMIT`), HarmonyOS from Node.js.
`lakutata mobile stage` bundles the application for it into the place where the native project takes it:
`android/app/src/main/assets/nodejs` (copied into the files of the application at its first launch and after each
update), `ios/nodejs` (put into the bundle of the application by its build) or
`harmony/entry/src/main/resources/resfile/nodejs` (run from the resources of the HAP). These are left out of git, with
`native/node/out`.

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
Node.js project first (`npm run stage:<platform>`); for HarmonyOS, bundle the user interface too
(`npx react-native bundle-harmony --dev false --bundle-output harmony/entry/src/main/resources/rawfile/bundle.harmony.js`,
which `npm run harmony` does).
