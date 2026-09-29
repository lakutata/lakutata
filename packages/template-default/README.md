# @lakutata/template-default

The default template of the [lakutata](https://github.com/lakutata/lakutata) projects: a minimal application whose
controller serves HTTP actions with the express adapter.

```bash
npx @lakutata/cli create --name my-app
```

The files of the project are in `template/`; `lakutata create` fills `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`,
`{$APP_AUTHOR}` and `{$APP_LICENSE}`, and renames `_gitignore` to `.gitignore`.
