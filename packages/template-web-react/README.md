# @lakutata/template-web-react

The React web template for [lakutata](https://github.com/lakutata/lakutata) projects. The service serves its HTTP API
under `/api` and a React single-page application built with Vite (`staticUI`), from one process, one port and one Docker
image. The project is a workspace: `packages/app` is the service, and `packages/ui` the application.

```bash
npx @lakutata/cli create --name my-app --template web-react
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` and `_dockerignore` to `.gitignore` and `.dockerignore`.
