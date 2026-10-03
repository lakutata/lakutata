# @lakutata/template-electron-react

The Electron template of the [lakutata](https://github.com/lakutata/lakutata) projects with React: the main process is a
lakutata application serving the actions of its controllers over IPC to the renderer (React, Vite), isolated from Node.js;
the application is packaged by `lakutata package installer` (electron-builder), for Linux in Docker (`npm run package:linux`).

```bash
npx @lakutata/cli create --name my-app --template electron-react
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}` and `{$APP_LICENSE}`, and renames `_gitignore` and `_dockerignore`.
