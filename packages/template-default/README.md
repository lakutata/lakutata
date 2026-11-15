# @lakutata/template-default

The default template for [lakutata](https://github.com/lakutata/lakutata) projects: a minimal application whose
controller serves HTTP actions through the Express adapter.

```bash
npx @lakutata/cli create --name my-app
```

The files of the project are in `template/`, and those of its features (`--with`) in `features/`. `lakutata create`
fills in `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the
version of the lakutata packages), and renames `_gitignore` to `.gitignore`.
