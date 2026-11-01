# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) mobile application for Android and iOS, made with
[Capacitor](https://capacitorjs.com). The application runs in the Node.js that
[@capawesome/capacitor-nodejs](https://github.com/capawesome-team/capacitor-nodejs) embeds in it. The project is a
workspace:

- `packages/app`: the Node.js side, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  user interface through the bridge of the plugin (`capacitorServiceEntrypoint`);
- `packages/ui`: the user interface, React built by Vite, in the web view of the application. `window.ipc`
  (`packages/ui/src/ipc.ts`) invokes the actions of the application, `window.ipc.invoke({cmd: 'greet', name: 'you'})`,
  and listens to the events it pushes, `window.ipc.on('greeted', listener)` (`once`, `off`);
- `android` and `ios`: the native projects of Capacitor, opened in Android Studio and Xcode with `npx cap open android`
  and `npx cap open ios`.

```bash
npm run dev               # the user interface in a browser (Vite), served by the application running on the computer
npm test                  # build the packages and run their tests (the actions of the application, without a device)
npm run android           # build the application and run it on an emulator or a device of Android
npm run ios               # build the application and run it on a simulator of iOS (macOS, Xcode)
npm run dev:android       # run it on the emulator running: its pages live reloaded, its Node.js side deployed again when it changes
npm run dev:ios           # the same on a simulator of iOS
npm run package:android   # the release bundle of Android (AAB)
npm run package:ios       # the archive of iOS, exported for App Store Connect
npm run version:patch     # give the packages their next version
```

A new action: a method of a controller of `packages/app/src/controllers` decorated by
`@ServiceAction({cmd: 'name'}, DTO)`, invoked by the user interface with `window.ipc.invoke({cmd: 'name', ...input})`:
its input is validated by its DTO, its result is given back, its errors are thrown in the user interface (with their
`errno`). Each page is a client of the application: its id is the `clientId` of the context of its requests, which the
entrypoint pushes events to, `this.entrypoint.notify(clientId, 'event', ...args)`, or to every client,
`this.entrypoint.broadcast('event', ...args)`.

`npm run dev` runs the application on the computer and serves its actions over HTTP on the port `DEV_PORT` (9000 by
default): the user interface in the browser reaches it there, and so do tools such as Postman or curl. `POST /` with
`{"cmd": "greet", "name": "you"}` answers the response of the action, with the id of the client in the `id` header;
`GET /events?id=<client>` streams the events pushed to the client (Server-Sent Events).

## The id of the application

The id of the application on Android and iOS is `{$APP_BUNDLE_ID}` (`lakutata create --bundle-id` sets it). It is the
`appId` of `capacitor.config.json`, the `applicationId` of `android/app/build.gradle`, the `PRODUCT_BUNDLE_IDENTIFIER`
of `ios/App/App.xcodeproj/project.pbxproj` and the `--app-id` of the `dev:android` and `dev:ios` scripts of
`packages/app/package.json`: change it in all four places. The package of the Java code (`dev.lakutata.mobile`) is not
the id and can stay as it is.

## The development

Android needs Android Studio (its SDK in `ANDROID_HOME`, an emulator, and a JDK such as the one it ships with); iOS
needs Xcode on macOS. `npm run android` and `npm run ios` build the packages, make the Node.js project
(`lakutata mobile stage`), copy everything into the native projects (`npx cap sync`), then build the application and
start it (`lakutata mobile run`): on Android through `npx cap run android`, on iOS on the simulator running, else on the
newest iPhone.

`npm run dev:android` and `npm run dev:ios` install the application on the emulator running, or on the simulator (the
one running, else the newest iPhone), with its pages loaded from the Vite dev server at `http://localhost:5173`, and
watch `packages/app`: when it changes, the Node.js project is built and deployed into the installed application, which
starts again (`lakutata mobile deploy`), without installing it again. On Android this works with debug builds only.
Once stopped, the installed application still loads its pages from the dev server: `npm run android` or
`npm run ios` installs it again with its own files.

## The Node.js of the application

The plugin embeds Node.js 18.20.4: `lakutata mobile stage` bundles the application for it into
`packages/ui/dist/nodejs`, which `npx cap sync` copies into the native projects. There, `process.platform` is `android`
or `ios`, which `packages/app/src/App.ts` uses to serve the actions through the bridge of the plugin, and the process
keeps running for as long as the application does. iOS allows no JIT, so Node.js has no WebAssembly there: `fetch()` is
removed (`node:http` and `node:https` work). On Android, `os.tmpdir()` is the cache directory of the application.

The files whose names start with a dot stay in the assets of Android: `android/app/build.gradle` keeps them
(`ignoreAssetsPattern`), since the Node.js project holds some.

## Native addons

`lakutata mobile stage` builds the native addons of the dependencies for Android and iOS from their sources (their
`binding.gyp`, which node-gyp builds when they are installed), against the Node.js of the plugin. For Android it builds
them for arm64-v8a, armeabi-v7a and x86_64 with the NDK (Android Studio installs it from the SDK Manager, under
SDK Tools; or set `ANDROID_NDK_HOME`); packages that ship prebuilt addons of Android (`prebuilds/android-arm64`) keep
them. For iOS it builds them on macOS with Xcode, as frameworks in `ios/App/App/NodeAddons`, which the project of iOS
embeds in the application and signs with it. The first build of a package takes a while (minutes for a large one); the
builds are kept in the cache of lakutata, and `npm run dev:android` and `npm run dev:ios` build for the emulator or the
simulator only.

## The icons

The icons and the splash screens of both systems can be generated from one image with
[@capacitor/assets](https://github.com/ionic-team/capacitor-assets): `npx @capacitor/assets generate`, from
`assets/logo.png` (and `assets/logo-dark.png` for the dark mode).

## The packaging

`npm run package:android` makes the release bundle of Android (`npx cap build android`), signed with the keystore given
by the `android.buildOptions` of `capacitor.config.json` (`keystorePath`, `keystorePassword`, `keystoreAlias`,
`keystoreAliasPassword`). `npm run package:ios` archives the application and exports it (`npx cap build ios`) with the
signing of the Xcode project: choose your team in Xcode (`npx cap open ios`, then Signing & Capabilities), or give
the `ios.buildOptions` of `capacitor.config.json`.
