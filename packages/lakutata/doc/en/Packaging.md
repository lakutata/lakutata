# Lakutata Packaging

A compiled application can be shipped without its `node_modules`, in three forms:

- a **bundle**: one JavaScript file that Node.js runs;
- an **executable**: one program that runs without Node.js installed;
- **installers**: the packages of the system (deb, rpm, pkg, msi…) that install the executable, put its program in the
  PATH and can register it as a service ([Installers](Installers.md)).

`lakutata package bundle`, `package exe` and `package installer` make them with `@lakutata/builder`, which the project
installs (`npm install --save-dev @lakutata/builder`; the templates that pack their application already have it).

## 1. What is packed

- **The compiled application**: the output of `tsc` (which emits the metadata of the decorators), not the TypeScript
  sources, so build it first. The entry is `--entry`, else the `main` of the `package.json`, else `build/App.js`.
- **Its dependencies**, bundled by esbuild into one file, except the native addons and the files read by path
  (sections 3 and 4). The packages of the framework, and those built on it, are always bundled, so that there is one
  copy of the framework, of its classes and of its container.
- **CommonJS**: the bundle is a CommonJS file, so the application cannot use top-level `await`; await inside an async
  function instead.
- **Optional dependencies** that are not installed (the drivers of the stores the application does not use) are left
  out: loading one throws at run time, as it would without the bundle.
- **Resources**: the other files the application reads at run time (the built pages of a web interface, templates,
  data) are declared in its `package.json` (section 6).

## 2. Bundles

```bash
npm run build
npx lakutata package bundle      # dist/<name>.cjs
node dist/greet.cjs
```

```
✔ dist/greet.cjs (1.1 MB): node dist/greet.cjs
✔ dist/greet.native: the native addons (better-sqlite3) and the scripts run on their own (build/child.js), distributed with the bundle
✔ dist/greet.resources: the resources (texts), distributed with the bundle
```

The name is the first `bin` of the `package.json`, else the name of the package without its scope. When needed, two
directories are written next to the bundle and must be shipped with it: `dist/<name>.native/` (native addons, scripts
run on their own, files read by path) and `dist/<name>.resources/` (the resources). The bundle runs from any
directory, once moved with them.

| Option | Meaning |
|---|---|
| `--entry <file>` | The compiled entry |
| `--outfile <file>` | The bundle, `dist/<name>.cjs` by default |
| `--no-minify` | Do not minify the bundle (the names of the classes are kept either way) |
| `--external <modules...>` | Modules left out of the bundle, loaded at run time from a `node_modules` next to it |
| `--node <version>` | The version of Node.js running the bundle (`18.10` for NW.js 0.70): the bundle is written in the syntax that version reads; the one running the tool by default |

## 3. Native addons

The packages holding `.node` files (better-sqlite3, the addons of the workspace made by
[`lakutata add --native`](NativeAddons.md)), and the packages that load them through computed paths (sharp), cannot be
bundled. They are left out, and laid out as in `node_modules` in `dist/<name>.native/`, with what they load at run time:

- all their files, and those of the packages of the shared libraries their addons link (such as the libvips of sharp),
  but not their C and C++ sources and objects (better-sqlite3 holds the sources of SQLite), nor what built them (the
  files of node-gyp and of CMake in `build/`, the `target` directory of cargo, the static and import libraries);
- the JavaScript they load;
- the addons of the application itself (`createRequire(import.meta.url)('./x.node')`).

The type declarations, source maps, TypeScript sources and documentation of the packages are left out. An addon is
built for the platform and the architecture of the machine, and needs the system libraries it was built for, so pack
the application of each platform on that platform.

## 4. Files read by path

The bundle is not where the modules were: a script started on its own (a worker, a child process of `fork()`) or a
file the application reads (`defaults.json`, a directory of schemas) would not be found next to it. The tool finds the
paths built from the location of a module, in the modules of the application and in those of its packages, and
rewrites them to point into `dist/<name>.native/`:

| Path | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | Also `pathToFileURL(__filename)` |
| `path.join(import.meta.dirname, 'child.js')`, `path.resolve(__dirname, '../schema')` | Also with `path.dirname(fileURLToPath(import.meta.url))` |
| `__dirname + '/worker.js'`, `` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')` | The extension is found as Node.js finds it |
| `` path.join(__dirname, 'locales', `${lang}.json`) `` | Partly known: every file its pattern matches is shipped |

| The path names | |
|---|---|
| A script (`.js`, `.cjs`) | Bundled on its own, with what it loads |
| Another file, a directory of data | Copied |
| A directory that holds the module (`path.join(__dirname, '..')`: the application, its package) | Not shipped, with a warning: declare its files as resources |
| A directory that holds scripts or packages (`package.json`, `node_modules`) | Not shipped, with a warning: its scripts would need their packages at run time |
| Nothing yet (a directory the application creates) | Left as it is |

```typescript
import {fork} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'

//Both are shipped: the script bundled on its own, the file copied
fork(path.join(import.meta.dirname, 'child.js'), ['one', 'two'])
const defaults: Record<string, unknown> = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'))
```

The tool warns, with the file and the line, of what it cannot follow in the modules of the application: a worker whose
path is known only at run time (`new Worker(file)`) or relative to the current directory (`new Worker('./worker.js')`),
and a script that the application also imports (it would be bundled twice, with two copies of its module). Build these
paths from the directory of their module, or ship the files as resources.

## 5. Executables

```bash
npx lakutata package exe                   # dist/<name> (dist/<name>.exe on Windows), with Node.js
npx lakutata package exe --runtime bun     # with Bun
```

```
› Node.js v24.11.1 embedded
› Resources embedded, extracted at the first run: texts
› Scripts run on their own embedded, extracted at the first run: build/child.js
✔ dist/greet (darwin-arm64, 112.9 MB)
```

An executable is made for the platform it is made on. Make the executables of the other platforms on those platforms,
as their native addons are built there: a CI matrix of Linux, macOS and Windows machines, or a container of the
architecture for Linux (`docker run --platform linux/arm64`); the README of the `cli` template shows both.

| Option | Meaning |
|---|---|
| `--runtime node` (default) | The bundle is embedded in a copy of the Node.js running the tool, or of `--node-program` (a single executable application of Node.js): about 110 MB on macOS arm64 |
| `--runtime bun` | The bundle is compiled by Bun (the `bun` package of the project, else the `bun` of the system): about 70 MB on macOS arm64, and it starts faster; the runtime is then Bun |
| `--layout file` (default) | One file: the native addons, the files read by path and the resources are embedded, and extracted when it starts |
| `--layout directory` | `dist/<name>/` holds the executable, `native/` and `resources/`, loaded from there without extraction (the installers use it) |
| `--outdir <directory>` | Where the executable is written, `dist` by default |
| `--node-program <path>` | The node embedded instead of the one running the tool: a Node.js 20.12, 21.7 or later (`$(nvm which 22)`), so that an older Node.js can run the tool; the bundle follows its syntax |
| `--entry`, `--no-minify`, `--external` | As for a bundle |

- **Extraction**: an executable of the file layout extracts what it embeds at its first run, into its cache directory,
  in a directory named after the content, so each version extracts once: `~/Library/Caches/<name>` on macOS,
  `%LOCALAPPDATA%\<name>\Cache` on Windows, `$XDG_CACHE_HOME/<name>` or `~/.cache/<name>` on Linux, or the directory
  given by `LAKUTATA_NATIVE_DIR`. When the cache directory cannot be written, it uses `<name>` in the temporary
  directory (not when `LAKUTATA_NATIVE_DIR` is given).
- **Native addons**: Bun loads the addons of Node-API, but may not load those built on the V8 API of Node.js: an
  executable of Bun warns of them, and fails when it loads such a package (better-sqlite3, for example). On Alpine
  (musl), the executables of Node.js do not load native addons: make them with Bun.
- **External modules**: the `--external` modules are loaded from a `node_modules` next to the executable.
- **Child processes**: an executable started for one of its scripts (`fork(path.join(import.meta.dirname, 'child.js'))`)
  runs that script, in both layouts, with its arguments. With Node.js, `require.main` is that script, as in Node.js;
  with Bun, it is not.
- **No `.env`**: the executables do not load the `.env` of the directory they run in; use `LAKUTATA_ENV_FILE`
  (section 6).
- **Icon and signature**: `lakutata.icon` in the `package.json` (a square PNG of 256 px or more) becomes the icon of the
  Windows executables. The executables of macOS are signed ad hoc. The ones of Windows made with Node.js keep the
  signature of `node.exe`, which no longer matches: sign them (signtool) before distributing them.

## 6. At run time

The resources are declared as a list of `{from, to}` objects in `lakutata.resources`: `from` is a file or a directory
of the project (it may be outside the package, such as `../ui/dist`), `to` its path among the resources.

```json
{
  "lakutata": {
    "resources": [{"from": "../ui/dist", "to": "ui"}]
  }
}
```

`isPackaged()` and `resourcesPath()` (from `lakutata`) tell the application how it runs:

| How it runs | `isPackaged()` | `resourcesPath()` |
|---|---|---|
| Not packed (`node build/App.js`, `electron .`) | `false` | `undefined` |
| A bundle | `true` | `dist/<name>.resources` next to the bundle |
| An executable, file layout | `true` | The directory the resources were extracted to |
| An executable, directory layout, or an installed application | `true` | `resources` next to the executable |
| A packaged Electron application | `true` | `main.resources` in the resources of Electron |

`resourcesPath()` returns the path even when the application declares no resources, so the directory may not exist.
The application chooses where to read its files from:

```typescript
import {createRequire} from 'node:module'
import path from 'node:path'
import {resourcesPath} from 'lakutata'

const resources: string | undefined = resourcesPath()
//The built pages of the "ui" package of the workspace: among the resources when packed, in its dist directory otherwise
const ui: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
```

Every packed form loads the environment file named by `LAKUTATA_ENV_FILE` before the application starts: its lines
`NAME=value` or `NAME="value"`, and comments (`#`). Its values replace the variables already set.

```bash
LAKUTATA_ENV_FILE=/etc/greet.env ./greet
```
