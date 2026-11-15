# @lakutata/template-electron-vue

The Electron template for [lakutata](https://github.com/lakutata/lakutata) projects, with Vue. The main process is a
lakutata application that serves the actions of its controllers over IPC to the renderer (Vue, Vite), which is isolated
from Node.js. The application is packaged by `lakutata package installer` (electron-builder), and for Linux in Docker as
well (`npm run package:linux`).

```bash
npx @lakutata/cli create --name my-app --template electron-vue
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` and `_dockerignore` to `.gitignore` and `.dockerignore`.
