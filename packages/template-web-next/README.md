# @lakutata/template-web-next

The Next.js web template of the [lakutata](https://github.com/lakutata/lakutata) projects: the service serves its HTTP API
under `/api` and a Next.js application (rendered on the server) from one process, one port and one Docker image. The
project is a workspace: `packages/app` is the service, `packages/ui` the Next.js application and its `renderUI` handler.

```bash
npx @lakutata/cli create --name my-app --template web-next
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`; `lakutata create`
fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` and `_dockerignore` to `.gitignore` and `.dockerignore`.
