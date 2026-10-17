# Lakutata Project Structure

This page describes the projects that `lakutata create` makes: the files of the `default` template, the workspaces of
the other templates, their scripts and their optional features, and how to make a template of your own.

## 1. The default template

```
my-app/
  package.json
  tsconfig.json
  README.md
  .gitignore
  src/
    App.ts                           starts the application
    config/Config.ts                 its options: components, entrypoint, adapters
    controllers/ExampleController.ts the actions
    dtos/GreetDTO.ts                 the input of the actions
    tests/App.spec.ts                the tests (node --test)
  build/                             the compiled application (npm run build)
```

`src/App.ts` starts the application with the options of `src/config/Config.ts` and logs its launch:

```typescript
import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

Application
    .run(config)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
```

`config()` returns the options of the application: its ID and name, its mode (`production` when
`NODE_ENV=production`), and the `entrypoint` component, which serves `ExampleController` over HTTP on the `PORT`
environment variable (8080 by default). It is a function so that the tests can start the application on a port of
their own: `src/tests/App.spec.ts` runs `Application.run(config(18080))`, requests `/example?name=you`, then disposes
of the application.

| Script | What it does |
|---|---|
| `dev` | `build`, then starts the application |
| `build` | Removes `build/` (`lakutata clean`), then compiles `src/` into it (`tsc`) |
| `start` | Starts the compiled application (`node build/App.js`) |
| `test` | `build`, then runs the tests (`node --test "build/tests/**/*.spec.js"`) |
| `migration:generate`, `migration:create`, `migration:run`, `migration:revert`, `migration:show` | The migrations of the databases (`lakutata migration`, see [Migrations](Migrations.md)) |

The template writes its own compiler options in `tsconfig.json` (the ones of `lakutata/tsconfig.json` that it needs,
with `module: "NodeNext"` and source maps); a project may extend `lakutata/tsconfig.json` instead, as the workspace
templates other than `cli` do.

## 2. The workspace templates

The other templates are npm workspaces: the application is the package `packages/app`, and the templates with an
interface or with installers add `packages/ui` (the web pages, or the renderer of Electron) and `packages/resources`
(the icon). The `service` template:

```
shop/
  package.json                       the workspace: workspaces ["packages/*"], the scripts
  Dockerfile                         the image of the service
  packages/
    app/
      package.json
      tsconfig.json                  extends lakutata/tsconfig.json
      src/
        App.ts
        config/Config.ts             the express adapter, its middlewares, compression
        controllers/ExampleController.ts
        controllers/HealthController.ts    GET /health
        dtos/GreetDTO.ts
        middlewares/Authenticate.ts  a bearer token, when API_TOKEN is set
        tests/App.spec.ts
```

| Script (root) | What it does |
|---|---|
| `npm run build` | Builds every package, in the order of their dependencies (`lakutata run rebuild`) |
| `npm test` | Runs the tests of every package (`lakutata run test`), without building them: run `npm run build` first |
| `npm run dev` | Starts the `dev` script of every package at once (`lakutata run dev --parallel`): the application, and the dev server of the interface when there is one |
| `npm start` | Starts the compiled application (`npm start -w app`) |
| `npm run version:patch` | Gives every package the next patch version (`lakutata version patch --yes`) |

The other templates add to this layout:

- `web-react` and `web-vue`: `packages/ui`, a Vite application. In development, its dev server
  (`http://localhost:5173`) forwards `/api` to the application; once built, the application serves the pages itself
  (the actions are under `/api`). The `lakutata.resources` of the application ship the built pages in its packed forms.
- `web-next` and `web-nuxt`: `packages/ui`, a Next.js or Nuxt application that the application renders in the same
  process.
- `cli`: a command line tool (`commanderCLIEntrypoint`), with the scripts `package:bundle` and `package:exe` that pack
  it into `dist/` ([Packaging](Packaging.md)).
- `electron-react` and `electron-vue`: the main process of Electron in `packages/app` (its window and its service
  actions over IPC), the renderer in `packages/ui`, and the scripts that make the installers.

The packed forms are written to `dist/` at the root of the workspace; `.gitignore` leaves out `build`, `dist` and the
outputs of the interfaces.

## 3. The features

`lakutata create --with <features>` (or the list offered in a terminal) adds optional features to the template:

| Feature | Templates | What it adds |
|---|---|---|
| `i18n` | all | The messages of the languages in `src/locales` (`en`, `zh-CN`), the `i18n` component, the language middleware, and the scripts `i18n:check` and `i18n:types` ([I18n](I18n.md)) |
| `installer` | `cli`, `service`, `web-*` | The `lakutata.installer` of the application, the scripts that make the installers (on the machine, and for Linux in Docker), and for the services a system service ([Packaging](Packaging.md)) |

The Electron templates make installers without this feature.

## 4. Templates of your own

`--template` also takes a template that is not in the catalog: `npm:<package>[@<version>]`,
`github:<owner>/<repo>[#<ref>]`, or a directory. A directory without a `template/` subdirectory is copied as it is; a
template package (as the official ones) holds:

- `template/`: the files of the project. npm does not publish some dotfiles, so they are named with `_` and renamed
  (`_gitignore` becomes `.gitignore`). `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and
  `{$LAKUTATA_VERSION}` are replaced in the text files.
- `features/<name>/`: the files of each feature, declared with its description in the `lakutata.features` of the
  `package.json` of the template. They are added to the project: a JSON file the project already has is merged into it
  (arrays replaced), any other file replaces the one of the template.
- Blocks kept for a feature only: lines between `//@if i18n` and `//@end` (with `//@else`, and `@if !i18n` for the
  opposite), written as comments of the file (`#@if`, `<!--@if-->`, `/*@if*/`).
