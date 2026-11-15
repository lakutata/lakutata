# @lakutata/template-cli

The command line template for [lakutata](https://github.com/lakutata/lakutata) projects. The actions of its controllers
are the commands of a tool (through the commander adapter). The tool is built into an executable that runs without
Node.js (`lakutata package exe`, for the platform it runs on), or bundled into one JavaScript file that `node` runs
(`lakutata package bundle`). The project is a workspace: the tool is its `app` package, and the packages it uses (native
addons…) sit next to it.

```bash
npx @lakutata/cli create --name my-tool --template cli
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` to `.gitignore` (and the `_dockerignore` of the `installer`
feature to `.dockerignore`).
