# @lakutata/template-mobile-react

The mobile template for [lakutata](https://github.com/lakutata/lakutata) projects, with React Native. A lakutata
application runs in a Node.js embedded in the mobile application and serves the actions of its controllers to the React
Native user interface, on Android, iOS and HarmonyOS (RNOH). The root of the project is the React Native application
(its entry and the native projects of the three systems), whose parts are the packages of a workspace: the application
in `packages/app`, the user interface in `packages/ui`, and in `packages/ipc` the native module that embeds Node.js (C++
shared by the three systems) and the `ipc` of the user interface. `lakutata mobile` downloads the libnode (from the
releases of [lakutata/libnode](https://github.com/lakutata/libnode)), makes the Node.js project, runs the application on
an emulator, a device or a simulator, and deploys the Node.js side during development.

```bash
npx @lakutata/cli create --name my-app --template mobile-react --bundle-id com.acme.myapp
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}`, `{$APP_BUNDLE_ID}` (the id of the
application on the three systems) and `{$LAKUTATA_VERSION}` (the version of the lakutata packages), and renames the
`_gitignore` files to `.gitignore`.
