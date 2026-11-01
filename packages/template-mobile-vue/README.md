# @lakutata/template-mobile-vue

The mobile template of the [lakutata](https://github.com/lakutata/lakutata) projects with Vue: a lakutata application
runs in the Node.js of the mobile application ([Capacitor](https://capacitorjs.com),
[@capawesome/capacitor-nodejs](https://github.com/capawesome-team/capacitor-nodejs)) and serves the actions of its
controllers to the user interface (Vue, Vite), on Android and iOS. The project holds the native projects of both
systems; `lakutata mobile` makes its Node.js project, runs the application on an emulator or a simulator and deploys
the Node.js side during the development.

```bash
npx @lakutata/cli create --name my-app --template mobile-vue --bundle-id com.acme.myapp
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$APP_BUNDLE_ID}` (the id of the application on Android and iOS), and renames
the `_gitignore` files.
