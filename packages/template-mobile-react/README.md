# @lakutata/template-mobile-react

The mobile template of the [lakutata](https://github.com/lakutata/lakutata) projects with React Native: a lakutata
application runs in a Node.js embedded in the mobile application and serves the actions of its controllers to the user
interface of React Native, on Android, iOS and HarmonyOS (RNOH). The project holds the native projects of the three
systems, the native module embedding Node.js (C++ shared by the three) and the Dockerfile building its libnode;
`lakutata mobile` builds the libnode, makes the Node.js project, runs the application on an emulator, a device or a
simulator, and deploys the Node.js side during the development.

```bash
npx @lakutata/cli create --name my-app --template mobile-react --bundle-id com.acme.myapp
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$APP_BUNDLE_ID}` (the id of the application on the three systems), and renames
the `_gitignore` files.
