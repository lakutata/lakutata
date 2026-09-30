# @lakutata/template-cli

The command line template of the [lakutata](https://github.com/lakutata/lakutata) projects: the actions of its controllers
are the commands of a tool (the commander adapter), built into executables which run without Node.js (`lakutata
executable`, for this platform and the others), or bundled into one JavaScript file run by node (`lakutata bundle`).

```bash
npx @lakutata/cli create --name my-tool --template cli
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}` and `{$APP_LICENSE}`, and renames `_gitignore` to `.gitignore`.
