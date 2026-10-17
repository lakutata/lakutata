# Lakutata Packaging

A compiled application can be shipped without its `node_modules`, in three forms:

- a **bundle**: one JavaScript file that Node.js runs;
- an **executable**: one program that runs without Node.js installed;
- **installers**: the packages of the system (deb, rpm, pkg, msi…) that install the executable, put its program in the
  PATH and can register it as a service.

`lakutata package bundle`, `package exe` and `package installer` make them with `@lakutata/builder`, which the project
installs (`npm install --save-dev @lakutata/builder`; the templates that pack their application already have it). The
README of `@lakutata/cli` gives every rule.

## 1. What is packed

- **The compiled application**: the output of `tsc` (which emits the metadata of the decorators), not the TypeScript
  sources, so build it first. The entry is `--entry`, else the `main` of the `package.json`, else `build/App.js`.
- **CommonJS**: the bundle is a CommonJS file, so the application cannot use top-level `await`; await inside an async
  function instead.
- **Native addons**: the packages holding `.node` files (better-sqlite3, sharp…) cannot be bundled. They are left out,
  with the code and the libraries they load at run time, and laid out as in `node_modules` in a directory shipped with
  the bundle.
- **Optional dependencies** that are not installed (the drivers of the stores the application does not use) are left
  out: loading one throws at run time, as it would without the bundle.
- **Files read by path**: a path built from the location of a module (`path.join(import.meta.dirname, 'child.js')`,
  `new URL('./defaults.json', import.meta.url)`) is found and rewritten. A script at that path is bundled on its own,
  any other file is copied. The README of `@lakutata/cli` lists the forms of paths that are followed.
- **Resources**: the other files the application reads at run time (the built pages of a web interface, templates,
  data) are declared in its `package.json` (section 6).

## 2. Bundles

```bash
npm run build
npx lakutata package bundle      # dist/<name>.cjs
node dist/my-app.cjs
```

The name is the first `bin` of the `package.json`, else the name of the package without its scope. When needed, two
directories are written next to the bundle and must be shipped with it: `dist/<name>.native/` (native addons, scripts
run on their own, files read by path) and `dist/<name>.resources/` (the resources).

| Option | Meaning |
|---|---|
| `--entry <file>` | The compiled entry |
| `--outfile <file>` | The bundle, `dist/<name>.cjs` by default |
| `--no-minify` | Do not minify the bundle (the names of the classes are kept either way) |
| `--external <modules...>` | Modules left out of the bundle, loaded at run time from a `node_modules` next to it |

## 3. Executables

```bash
npx lakutata package exe                   # dist/<name> (dist/<name>.exe on Windows), with Node.js
npx lakutata package exe --runtime bun     # with Bun
```

An executable is made for the platform it is made on. Make the executables of the other platforms on those platforms,
as their native addons are built there: a CI matrix of Linux, macOS and Windows machines, or a container of the
architecture for Linux (`docker run --platform linux/arm64`).

| Option | Meaning |
|---|---|
| `--runtime node` (default) | The bundle is embedded in a copy of the Node.js running the tool (a single executable application of Node.js): about 110 MB on macOS arm64 |
| `--runtime bun` | The bundle is compiled by Bun (the `bun` package of the project, else the `bun` of the system): about 70 MB on macOS arm64, and it starts faster; the runtime is then Bun |
| `--layout file` (default) | One file: the native addons, the files read by path and the resources are embedded, and extracted when it starts |
| `--layout directory` | `dist/<name>/` holds the executable, `native/` and `resources/`, loaded from there without extraction (the installers use it) |
| `--outdir <directory>` | Where the executable is written, `dist` by default |
| `--entry`, `--no-minify`, `--external` | As for a bundle |

- **Extraction**: an executable of the file layout extracts what it embeds into its cache directory, in a directory
  named after the content, so each version extracts once: `~/Library/Caches/<name>` on macOS,
  `%LOCALAPPDATA%\<name>\Cache` on Windows, `$XDG_CACHE_HOME/<name>` or `~/.cache/<name>` on Linux, or the directory
  given by `LAKUTATA_NATIVE_DIR`.
- **Native addons**: an addon needs the system libraries it was built for. Bun does not load every addon of Node.js:
  an executable of Bun with better-sqlite3 builds, but fails when it starts. On Alpine (musl), the executables of
  Node.js do not load native addons: make them with Bun.
- **External modules**: only the executables of Bun load the `--external` modules from a `node_modules` next to them;
  the executables of Node.js cannot load them.
- **Child processes**: in the file layout, an executable started for one of its scripts
  (`fork(path.join(import.meta.dirname, 'child.js'))`) runs that script, as Node.js does. In the directory layout, it
  starts the application again instead.
- **Icon and signature**: `lakutata.icon` in the `package.json` (a square PNG of 256 px or more) becomes the icon of the
  Windows executables. The executables of macOS are signed ad hoc. The ones of Windows made with Node.js keep the
  signature of `node.exe`, which no longer matches: sign them (signtool) before distributing them.

## 4. Installers

```bash
npx lakutata package installer     # dist/installer/
```

The installers are configured by `lakutata.installer` in the `package.json`:

```json
{
  "lakutata": {
    "installer": {
      "service": {"env": {"PORT": "8080"}},
      "linux": {"targets": ["deb", "rpm", "tar.gz"]}
    }
  }
}
```

| Platform | Installers (default) | Application installed in | Made with |
|---|---|---|---|
| Linux (glibc) | `deb`, `rpm`, `tar.gz` (also `archlinux`) | `/opt/<name>` | nFPM |
| Linux (musl, Alpine) | `apk`, `tar.gz` | `/opt/<name>` | nFPM |
| macOS | `pkg`, `tar.gz` | `/usr/local/lib/<name>` | `pkgbuild`, `productbuild` |
| Windows | `nsis`, `msi`, `zip` | `C:\Program Files\<name>` | NSIS, WiX |

- An installer holds the executable of the directory layout (`runtime: "bun"` in `lakutata.installer` makes it with
  Bun). Like the executables, the installers of a platform are made on that platform; `--target` chooses some of them.
- nFPM, NSIS, WiX and WinSW are downloaded once into the cache of the tool (`LAKUTATA_NFPM`, `LAKUTATA_NSIS`,
  `LAKUTATA_WIX` and `LAKUTATA_WINSW` give other copies).
- The other fields: `name` (the name of the package, the one of the program by default), `appId`, `productName`,
  `description`, `maintainer`, `homepage`, `license`, `vendor` (from the `package.json` by default), `addToPath`
  (`true` by default), and the scripts run by the installers (`preinstall`, `postinstall`, `preremove`, `postremove`),
  which the README of `@lakutata/cli` describes.
- Signature: the `pkg` installers of macOS are not signed, and the executables they hold are signed ad hoc only; a
  Developer ID signature and notarization are not made. On Windows, the executables made with Node.js keep the signature
  of `node.exe`, which no longer matches: sign them (signtool) before distributing them.

**The service** (`service: true`, or its options) runs the application when the system starts: systemd, OpenRC on
Alpine, launchd on macOS, WinSW on Windows. The installation starts it, an upgrade restarts it, and the removal stops it
first. Stopping the service ends the application gracefully (with `SIGTERM`; on Windows, with a Ctrl+C, which Node.js
receives as `SIGINT`).

| Service option | Meaning |
|---|---|
| `name`, `description` | Those of the package by default |
| `args` | The arguments of the application |
| `env` | Its environment (`MODE=production` by default), written to an environment file that administrators may change and upgrades keep: `/etc/<name>/<name>.env` on Linux |
| `user` | Its user: by default a system user named after the package, created by the installation (on Windows, the virtual account of the service) |
| `restart` | `on-failure` (default), `always` or `no` |
| `autoStart` | Start it with the system (`true` by default) |

Its working directory is `/var/lib/<name>` on Linux, `/usr/local/var/lib/<name>` on macOS and `C:\ProgramData\<name>` on
Windows.

## 5. Electron applications

With `"runtime": "electron"`, `package installer` hands the work to electron-builder, which the project installs with
`electron`. The main process is bundled (Electron left out), and its native addons and resources go into the resources
of Electron. The installers are `deb` on Linux, `dmg` on macOS and `nsis` on Windows by default (`linux.targets`,
`mac.targets`, `win.targets`), and `lakutata.installer.electron` is merged into the configuration of electron-builder
(icons, signature, updates…). An Electron application is not a service. The native addons are copied as they are
installed (electron-builder does not rebuild them): before packing, install the builds made for Electron
(`electron-rebuild`, or `prebuild-install --runtime electron`); an addon of Node-API, such as sqlite3, runs in both. The
`electron-react` and `electron-vue` templates are configured this way.

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
| Not packed (`node build/App.js`, `electron build/App.js`) | `false` | `undefined` |
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
