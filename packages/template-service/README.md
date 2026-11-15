# @lakutata/template-service

The service template of the [lakutata](https://github.com/lakutata/lakutata) projects: an HTTP API, deployed as a Docker
image. The project is a workspace whose `app` package is the service; other packages (a client SDK…) are added next to
it.

```bash
npx @lakutata/cli create --name my-service --template service
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`; `lakutata create`
fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` and `_dockerignore` to `.gitignore` and `.dockerignore`.
