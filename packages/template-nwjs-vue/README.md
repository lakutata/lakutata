# @lakutata/template-nwjs-vue

The NW.js template for [lakutata](https://github.com/lakutata/lakutata) projects, with Vue. The background script of
NW.js is a lakutata application that serves the actions of its controllers to the user interface (Vue, Vite), which runs
in a webview isolated from Node.js. The application is packaged into installers by `lakutata package installer`, and for
Linux in Docker as well (`npm run package:linux`). The project sets its own version of NW.js (`lakutata nwjs use`): by
default, the release fixed by the template, which `npm run nwjs:use -- latest` moves to the newest. The `win7` feature
sets it to 0.72.0, the last release that runs on Windows 7.

```bash
npx @lakutata/cli create --name my-app --template nwjs-vue
npx @lakutata/cli create --name my-app --template nwjs-vue --with win7
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` and `_dockerignore` to `.gitignore` and `.dockerignore`.
