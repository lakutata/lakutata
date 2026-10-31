# @lakutata/template-nwjs-react

The NW.js template of the [lakutata](https://github.com/lakutata/lakutata) projects with React: the background script of
NW.js is a lakutata application serving the actions of its controllers to the user interface (React, Vite), isolated
from Node.js in a webview; the application is packaged into installers by `lakutata package installer`, for Linux in
Docker (`npm run package:linux`). The version of NW.js is the one of the project (`lakutata nwjs use`): by default the
release the template was published with (`npm run nwjs:use -- latest` moves it to the newest); the feature `win7` makes
it 0.72.0, the last one running on Windows 7.

```bash
npx @lakutata/cli create --name my-app --template nwjs-react
npx @lakutata/cli create --name my-app --template nwjs-react --with win7
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}` and `{$APP_LICENSE}`, and renames `_gitignore` and `_dockerignore`.
