# Lakutata Project Structure

This guide describes the projects that `lakutata create` generates: the files in the `default` template, the workspaces
of the other templates, their scripts and optional features, and how to create your own template.

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

`src/App.ts` launches the application with the options from `src/config/Config.ts` and logs the launch:

```typescript
import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

Application
    .run(config)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
```

`config()` returns the application's options: its ID and name, its mode (`production` when `NODE_ENV=production`), and
the `entrypoint` component, which serves `ExampleController` over HTTP on the port in the `PORT` environment variable
(8080 by default). It is a function so that tests can launch the application on their own port: `src/tests/App.spec.ts`
runs `Application.run(config(18080))`, requests `/example?name=you`, then disposes of the application.

| Script | What it does |
|---|---|
| `dev` | `build`, then launches the application |
| `build` | Removes `build/` (`lakutata clean`), then compiles `src/` into it (`tsc`) |
| `start` | Launches the compiled application (`node build/App.js`) |
| `test` | `build`, then runs the tests (`node --test "build/tests/**/*.spec.js"`) |
| `migration:generate`, `migration:create`, `migration:run`, `migration:revert`, `migration:show` | Database migrations (`lakutata migration`, see [Migrations](Migrations.md)) |

The template defines its own compiler options in `tsconfig.json` (those it needs from `lakutata/tsconfig.json`, with
`module: "NodeNext"` and source maps); a project may extend `lakutata/tsconfig.json` instead, as the workspace templates
other than `cli` do.

## 2. The workspace templates

The other templates are npm workspaces: the application is the `packages/app` package, and templates with an interface
or installers add `packages/ui` (the web pages, the Electron renderer or the NW.js user interface) and
`packages/resources` (the icon). The `service` template:

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
| `npm run build` | Builds every package in dependency order (`lakutata run rebuild`) |
| `npm test` | Builds every package, then runs their tests (`npm run build && lakutata run test`) |
| `npm run dev` | Runs the `dev` script of every package in parallel (`lakutata run dev --parallel`): the application, and the interface's dev server when there is one |
| `npm start` | Launches the compiled application (`npm start -w app`) |
| `npm run version:patch` | Sets every package to the next patch version (`lakutata version patch --yes`) |

The other templates extend this layout:

- `web-react` and `web-vue`: `packages/ui`, a Vite application. In development, its dev server (`http://localhost:5173`)
  forwards `/api` to the application; once built, the application serves the pages itself (the actions are under
  `/api`). The application's `lakutata.resources` include the built pages in its packed forms.
- `web-next` and `web-nuxt`: `packages/ui`, a Next.js or Nuxt application that the application renders in the same
  process.
- `cli`: a command-line tool (`commanderCLIEntrypoint`), with the `package:bundle` and `package:exe` scripts, which pack
  it into `dist/` ([Packaging](Packaging.md)).
- `electron-react` and `electron-vue`: the Electron main process in `packages/app` (its window and its service actions
  over IPC), the renderer in `packages/ui`, and the scripts that build the installers.
- `nwjs-react` and `nwjs-vue`: the NW.js background script in `packages/app` (its window, whose host page in
  `packages/app/host` holds the user interface in a webview, and its service actions), the user interface in
  `packages/ui`, the NW.js version in `packages/app/nwjs.json` (written by `npm run nwjs:use -- <version>`), and the
  scripts that build the installers.
- `mobile-react`: the application in `packages/app`, which runs in a Node.js embedded in the mobile application and
  serves its actions to the React Native user interface. The user interface is in `packages/ui` (`src/App.tsx`), the
  same on all three systems. `packages/ipc` connects the user interface to the Node.js side and holds the native module
  that embeds Node.js (`native`) and the `ipc` object that the user interface imports. Electron and NW.js provide such
  a channel themselves; React Native has none, so the template provides it as a package. The root holds the React
  Native application itself, with its entry (`index.js`, which registers the component from `packages/ui`),
  `app.json`, the Metro and Babel configurations, and the native projects (`android`, `ios`, `harmony`), which carry
  the application ID (`lakutata create --bundle-id`). The template's scripts download libnode, run the application on
  an emulator, a device or a simulator, and deploy its Node.js side (`npm run node:android`, `npm run android`, `npm run
  deploy:android`, and the same for `ios` and `harmony`).

Packed forms are written to `dist/` at the workspace root; `.gitignore` excludes `build`, `dist` and the interfaces'
build outputs.

## 3. The features

`lakutata create --with <features>` (or the list offered in a terminal) adds optional features to the template:

| Feature | Templates | What it adds |
|---|---|---|
| `i18n` | all | Messages for each language in `src/locales` (`en`, `zh-CN`), the `i18n` component, the language middleware, and the `i18n:check` and `i18n:types` scripts ([Internationalization (i18n)](I18n.md)) |
| `installer` | `cli`, `service`, `web-*` | The application's `lakutata.installer`, the scripts that build the installers (on the local machine, and in Docker for Linux), and, for services, a system service ([Installers](Installers.md)) |
| `win7` | `nwjs-*` | NW.js 0.72.0 (the last release that runs on Windows 7, 8 and 8.1) instead of the release the template was published with, and the `package:ia32` script, which builds installers for 32-bit Windows |

The Electron and NW.js templates build installers without the `installer` feature.

## 4. Templates of your own

`--template` also accepts a template that is not in the catalog: `npm:<package>[@<version>]`,
`github:<owner>/<repo>[#<ref>]`, or a directory. A directory without a `template/` subdirectory is copied unchanged; a
template package (like the official ones) contains:

- `template/`: the project's files. npm does not publish some dotfiles, so they are named with `_` and renamed
  (`_gitignore` becomes `.gitignore`). `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and
  `{$LAKUTATA_VERSION}` are replaced in text files.
- `features/<name>/`: each feature's files, declared with the feature's description in `lakutata.features` in the
  template's `package.json`. They are added to the project: a JSON file that the project already has is merged into the
  existing file (arrays are replaced), and any other file replaces the template's file.
- Blocks kept only for a feature: lines between `//@if i18n` and `//@end` (with `//@else`, and `@if !i18n` for the
  opposite), written in the file's comment syntax (`#@if`, `<!--@if-->`, `/*@if*/`).
