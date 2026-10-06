# @lakutata/cli

The command line tool of the [lakutata](https://github.com/lakutata/lakutata) framework.

```bash
npx @lakutata/cli create --name my-app
# or installed: npm install -g @lakutata/cli
lakutata create --name my-app
```

## Commands

### `lakutata create`

Create a project from a template. The options are given on the command line; in a terminal, the missing ones are asked,
and the project is created once it is confirmed (`--yes` skips the confirmation).

| Option | |
|---|---|
| `--name <name>` | the name of the application (required) |
| `--id <id>` | the ID of the application (a package name), its name in lower case by default |
| `--template <template>` | the template, `default` by default: an official template (`lakutata templates` lists them), `npm:<package>[@<version>]`, `github:<owner>/<repo>[#<ref>]` or a directory |
| `--path <directory>` | the directory the project directory is created in, the current one by default |
| `--init` | create the project in the directory itself (it may exist and not be empty) |
| `--description`, `--author`, `--license` | the information of the application |
| `--with <features>` | the optional features of the template enabled, separated by commas (`lakutata templates` lists them): `i18n`. In a terminal without `--with`, they are chosen |
| `--package-manager <npm\|pnpm\|yarn\|none>` | the package manager installing the dependencies, the one running the tool by default |
| `--no-git` | do not initialize a git repository |
| `--yes` | create the project without confirmation |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
lakutata create --name my-service --template service --with i18n --yes
```

The official templates have the feature `i18n`: the messages of the application in several languages
(`lakutata/com/i18n`), in `src/locales` (`en.json`, `zh-CN.json`), bundled with the code; each request answered in its
language (the language of the environment for the command line tools and the Electron applications), its validation
errors too; the scripts `i18n:check` and `i18n:types`.

### `lakutata templates`

List the official templates. They are npm packages (`@lakutata/template-<name>`) listed by the catalog package
`@lakutata/templates`, downloaded from the npm registry of the user (a mirror such as npmmirror works as it does for the
dependencies): no access to GitHub is needed. The catalog is kept for a day (`--refresh` fetches it again).

The version of an official template is the newest one of the major version of the tool. The downloaded templates are
kept: when the registry cannot be reached, the kept ones are used.

A template package has its files in its `template/` directory. The npm packages cannot hold some files under their
name: `_gitignore`, `_npmrc`… are renamed `.gitignore`, `.npmrc`… when the project is created. The text files are filled
with the information of the project: `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and
`{$LAKUTATA_VERSION}` (the version of the framework).

A template has optional features, which `lakutata create --with <features>` enables (or the user chooses in a terminal):

- they are declared by the `package.json` of the template package, their names and their descriptions:
  `"lakutata": {"template": "default", "features": {"i18n": "The messages in several languages"}}`;
- the files of a feature are in `features/<name>/`, beside `template/` (published with it, in the `files` of the
  package): they are added to the project when the feature is enabled; a JSON file the project has is merged into its
  one (the scripts of `package.json`, the options of `tsconfig.json`);
- the files of the template have the blocks of the features, the lines between `//@if <feature>` and `//@end` (or
  `//@else`; `//@if !<feature>` when the feature is not enabled), kept when the feature is enabled and removed
  otherwise; the lines of the markers are removed. The markers are comments of their languages: `//@if i18n`,
  `#@if i18n`, `<!--@if i18n-->`, `/*@if i18n*/`.

### `lakutata info`

Show the versions of the tool, of the framework (and their latest versions), of Node.js, and of the framework of the
project of the current directory.

### `lakutata clean [paths...]`

Remove paths of the package of the current directory, on every platform (as `rm -rf`, without `shx` or `rimraf`):
`lakutata clean build dist`. Without paths, the output directories of its `tsconfig.json` are removed (`outDir`, and
`declarationDir` when it has one, read through the configurations it extends): `"clean": "lakutata clean"`. A missing
path is skipped; the paths outside of the package, the package itself, `src`, `node_modules`, `.git` and `package.json`
are never removed. In a workspace, `lakutata run clean` runs the `clean` script of each package.

## Workspaces

The projects made of several packages (`app`, `ui`, `proxy`…) are npm workspaces (the `workspaces` of the root
`package.json`, or a `pnpm-workspace.yaml`). The tool builds and versions their packages; it is the part of lerna the
projects use, without lerna.

### `lakutata run <script>`

Run a script in the packages having it, in the order of their dependencies (a package runs once the packages it depends
on ran); the packages independent of each other run at the same time. The output is prefixed by the name of the package.

| Option | |
|---|---|
| `--concurrency <n>` | how many packages run at a time, the number of the processors by default |
| `--parallel` | run all the packages at once, without waiting for their dependencies: the long-running scripts (`lakutata run dev --parallel`) |
| `--no-bail` | do not stop at the first failure: the packages which do not depend on the failed ones run |
| `--scope <names...>` | the packages run, by name (`*` wildcards) |

### `lakutata version <bump>`

Give all the packages the next version (`major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`
with `--preid <id>`, or a version), update the dependencies between them (`^0.0.16` becomes `^0.0.17`: with the `0.x`
versions a range matches its version only) and the lock file (`npm ci` fails otherwise). The version of the workspace is
the one of `lerna.json` when there is one, of the root `package.json` otherwise. `--git` commits the changes and tags
them `v<version>`; `--yes` gives the version without confirmation.

### `lakutata add <name>`

Add a package to the workspace: `packages/<name>` (without its scope), of the version of the workspace, with its
`clean`, `build`, `rebuild` and `test` scripts and a test; `--to <package>` makes a package of the workspace depend on it.
Then `npm install` links it.

- `lakutata add greeting`: a TypeScript package (`src/index.ts` compiled into `build`, its declarations emitted).
- `lakutata add @acme/capture --native [gyp|cmake|rust]`: a native addon, by its build system:
  - `gyp` (by default): C++ with [node-addon-api](https://github.com/nodejs/node-addon-api), built by node-gyp from
    `binding.gyp`;
  - `cmake`: C++ with node-addon-api, built by [cmake-js](https://github.com/cmake-js/cmake-js) from `CMakeLists.txt`;
  - `rust`: Rust with [napi-rs](https://napi.rs), built by cargo (`Cargo.toml`, `build.rs`, `rust/lib.rs`).

  Node-API is stable across the versions of Node.js and Electron: the same addon runs in both without being rebuilt.
  The addon is built into `build/Release` (`npm run build:native`, and when the package is installed), loaded by
  node-gyp-build from `src/index.ts`, compiled into `dist`; the C++ ones are built for the Macs with Intel and with Apple
  silicon in one file. `lakutata native` links their libraries; `binding.gyp` and `CMakeLists.txt` also show in their
  comments how the libraries and the options of the build are given: the libraries of the system, pkg-config, the
  static libraries of the package, the dynamic libraries shipped with the addon (copied next to it, found there by its
  rpath), the standard of C++, the options of each platform; a library built by its own Makefile is built before by a
  script (`build:deps`).
  `lakutata package bundle` and `lakutata package exe` ship the addon with the application, its dynamic libraries too. Building
  it needs a C++ toolchain (with CMake for `cmake`), or Rust for `rust`.

### `lakutata native <action> <value>`

Change the build of the native addon of the current directory, found by its build file (`binding.gyp`,
`CMakeLists.txt`, `Cargo.toml`): its text is edited in place, its comments and its layout kept; the sources of the
addon are not changed. A change already made changes nothing.

- `lakutata native link <library>`: link a library:
  - a library of the system: `lakutata native link pcap` (`ws2_32` with `--platform win`);
  - `--pkg-config`: a library found by pkg-config (`lakutata native link libpcap --pkg-config`; not on Windows);
  - `--framework`: a framework of macOS (`lakutata native link CoreFoundation --framework`);
  - a file of the package: a static library (`deps/lib/libfoo.a`; `foo.lib` on Windows) is linked into the addon; a
    dynamic one (`deps/lib/libfoo.dylib`, `libfoo.so`, `foo.dll` with its import library `foo.lib`) is copied next to
    the addon and found there at run time by its rpath (`@loader_path` on macOS, `$ORIGIN` on Linux). On macOS, its
    install name must be `@rpath/libfoo.dylib` (`install_name_tool -id`): the command tells it otherwise;
  - `--crate`: a crate of a Rust addon (`cargo add`).
- `lakutata native include <directory>`: a directory of headers (C++).
- `lakutata native define <NAME[=value]>`: a definition of the preprocessor (C++).

`--platform mac|linux|win` makes the change for one platform (the files of the libraries give theirs: `.dylib` macOS,
`.so` Linux, `.dll` and `.lib` Windows, `.a` every platform but Windows); `--target <name>` names the target changed
when the build file has several. What is written, by build system:

| | gyp | CMake | Rust |
|---|---|---|---|
| File | `binding.gyp`, or the `.gypi` it includes declaring the target | `CMakeLists.txt` | `.cargo/config.toml` (`[env]`), read by `build.rs` |
| Library | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | the `-sys` crates |
| Framework | `xcode_settings.OTHER_LDFLAGS` | `-framework` in `if(APPLE)` | `rustc-link-lib=framework=` |
| Dynamic library | `copies`, the rpath | `BUILD_RPATH`, a `POST_BUILD` copy | `rustc-cdylib-link-arg`, a `postbuild:native` copy |
| Headers, definitions | `include_dirs`, `defines` | `target_include_directories`, `target_compile_definitions` | none (crates) |
| Platform | `conditions` (`OS=="mac"`) | `if(APPLE)`, `if(WIN32)`, `if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`, `_LINUX`, `_WINDOWS`, `_UNIX` |

The Rust libraries are given to `build.rs` (by `lakutata add --native rust`), which gives them to cargo for the addon
only: the flags of rustc would be given to every crate it builds.

### `lakutata list`

List the packages, their versions and the packages they depend on.

### From lerna

| lerna | lakutata |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git` (the tag is not pushed) |

The publication stays `npm publish -w <package>`. The tool does not bump the packages independently, does not write
changelogs from the commits and does not cache the builds: the workspaces needing it keep lerna (or nx, turborepo) next
to it.

## Bundles and executables

The application of the current directory, compiled (`tsc`, which emits the metadata of the decorators), is packed by
`@lakutata/builder`: the one installed in the project (`npm install --save-dev @lakutata/builder`, as the templates
packing their applications do), else the one installed with the tool. Its functions (`bundleProject`,
`buildExecutable`) pack the applications from the scripts too.

### `lakutata package bundle`

Bundle the application and its dependencies into one CommonJS file (esbuild), run by node without `node_modules`:
`dist/<name>.cjs`, the name being the first `bin` of the `package.json`, or its name without its scope. The entry is the
`main` of the `package.json` (`--entry` changes it), the bundle is minified with the names of the classes kept
(`--no-minify`), `import.meta.url` is the URL of the bundle.

| Option | |
|---|---|
| `--entry <file>` | the compiled entry, the `main` of the `package.json` by default |
| `--outfile <file>` | the bundle, `dist/<name>.cjs` by default |
| `--no-minify` | do not minify the bundle |
| `--external <modules...>` | the modules left out of the bundle, loaded at run time from a `node_modules` next to it |

The bundles are CommonJS modules (the executables of Node.js run them): the ES modules of the application are converted,
without top-level `await` (await in an async function).

The native addons (`.node` files) cannot be bundled: their packages are found while the application is bundled (the
packages holding addons, and the packages loading them with computed paths, such as sharp) and left out of the bundle,
with what they load at run time (the JavaScript they require, the packages of the shared libraries linked with their
addons, such as libvips), laid out as in `node_modules`: `dist/<name>.native/`, distributed with the bundle. The tree
holds the files loaded at run time: the packages of the addons and of the shared libraries have all their files, the
other packages the JavaScript they load (traced) and their other files (the data they read), the packages loading their
files by paths which cannot be followed (`require(path.join(__dirname, name))`) all their files; the types, the source
maps, the TypeScript sources and the documentation of the packages are left out. The addons of
the application itself (`require('./x.node')`, `createRequire(import.meta.url)('./x.node')`) are there too.

The files the application reads by their paths are not followed by the bundler: the scripts it runs on their own (its
workers, `new Worker()`, the pools of workers given a file; its child processes, `fork()`; the modules it loads by their
paths, `require(path.join(__dirname, 'x.js'))`), its data (`fs.readFileSync(path.join(__dirname, 'defaults.json'))`, a
directory of schemas). And the bundle is not where its modules were: `path.resolve(__dirname, '../../schema')` of a
module of `build/config/` is the `schema/` of the project, not once bundled in `dist/`. A path to a file given from its
module is found wherever it is written, in the modules of the application and in the ones of its packages, and the
expression rewritten to the file in the native tree (`dist/<name>.native/.lakutata/files/`, the directories as in the
project, the packages linked from outside of it under `node_modules/`):

| The path names | |
|---|---|
| a script (`.js`, `.cjs`) | bundled on its own with what it loads (a CommonJS file, whatever the type of the project) |
| another file | copied (a `package.json` its type CommonJS, as the scripts next to it) |
| a directory of data | its files copied |
| a directory holding the module (`path.join(__dirname, '..')`: the application, its packages) | not shipped, warned of: its files are declared as resources (`lakutata.resources`, below) |
| a directory holding scripts or packages (`package.json`, `node_modules`) | not shipped, warned of: its scripts need their packages at run time |
| nothing yet (a directory the application creates) | left as it is |

The paths followed:

| Path | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | the URL of the module (as Vite); `pathToFileURL(__filename)` too |
| `import.meta.url + '/../worker.js'` | a text of the URL of the module |
| `path.join(__dirname, 'worker.js')`, `path.resolve(__dirname, …)` | `import.meta.dirname`, `path.dirname(fileURLToPath(import.meta.url))` too |
| `__dirname + '/worker.js'`, `` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')`, `require.resolve(path.resolve(__dirname, '../lib/worker'))` | the extension found as node finds it |
| `` path.join(__dirname, 'locales', `${lang}.json`) ``, `` new URL(`./jobs/${name}.js`, import.meta.url) `` | known in part: every file and directory its pattern matches (an expression matches a part of a name), its expression kept |

The code of tsc (`(0, node_path_1.join)(__dirname, 'worker.js')`) is followed. A script also imported by the application
is warned of: it is bundled twice, its module apart in each (its state, its classes). The workers of node
(`worker_threads`) whose scripts cannot be followed are warned of with their file and line, in the modules of the
application (the packages start workers from the paths their users give): a path known at run time only
(`new Worker(file)`, a variable or a property of a class holding one of the paths above is followed), or a path relative
to the current directory of the process (`new Worker('./worker.js')`, which node reads from there, not from the module);
their scripts are given from the directory of their module, or shipped as resources. The workers running a source
(`eval: true`) need nothing. The warnings name the modules of the application only, with their file and line.

The resources of the application, the files it reads at run time (the built pages of a web application, templates,
data), are declared by the `lakutata.resources` of its `package.json`, as the `extraResources` of electron-builder:

```json
"lakutata": {"resources": [{"from": "../ui/dist", "to": "ui"}]}
```

`from` is a file or a directory of the project, `to` its path in the resources: `dist/<name>.resources/`, distributed
with the bundle. The application finds them by `resourcesPath()` of lakutata (`undefined` when it does not run packed,
`isPackaged()` tells it).

### `lakutata package exe`

Make the executable of the application for the platform it runs on, which runs without Node.js installed: the bundle
embedded in the Node.js binary running the tool (the single executable applications of Node.js), `dist/<name>`
(`dist/<name>.exe` on Windows), with the code cache of the bundle (V8). The Node.js embedded is the version running the
tool.

With `--runtime bun`, the bundle is compiled by Bun (`bun build --compile --bytecode`, its bytecode is not parsed at
start) instead: the Bun of the project (the `bun`
package of npm, `npm install --save-dev bun`), else the one of the system. Its executables are smaller, start faster and
use less memory; the runtime is Bun's (JavaScriptCore, its implementation of the APIs of Node.js). The bundle and its
native addons are the ones of the executables of Node.js, which do not change for it. As them, the executables of Bun do
not load the `.env` and the `bunfig.toml` of the directory they run in (the application loads its `.env`), and the
mode is the one of their run: Bun replaces `process.env.NODE_ENV` with the mode of its build, the bundle reads it.

The executables of the other platforms are made on them, as the applications are built there: their native addons are
built for them, and they are tried there. The CI gives the machines of the platforms (a matrix of the Linux, macOS and
Windows runners); the Linux architectures are also made in a container of the architecture (`docker run --platform
linux/arm64`, as the cross builds of the templates).

| Option | |
|---|---|
| `--outdir <directory>` | the directory of the executable, `dist` by default |
| `--runtime <node\|bun>` | the runtime embedded: `node` (by default) or `bun` |
| `--layout <file\|directory>` | one file (by default), or a directory: `dist/<name>/` holding the executable, its native addons (`native/`) and its resources (`resources/`), loaded from there without extraction (the installers, the images) |
| `--entry`, `--no-minify`, `--external` | as `lakutata package bundle` |

The native addons, the files read by their paths and the resources are embedded in the executable (`--layout file`): at its
first run, it extracts them into its cache directory (`~/.cache/<name>`, `~/Library/Caches/<name>` on macOS,
`%LOCALAPPDATA%\<name>\Cache` on Windows, or `LAKUTATA_NATIVE_DIR`; the temporary directory when it cannot be written),
in a directory named after their content:
the next runs load them from there, the versions of the program do not share it. The addons need the system libraries they were built for (the
glibc version of the Linux prebuilt addons). The child processes of an executable run it (`process.execPath`): started
for one of its scripts (`fork(path.join(__dirname, 'child.js'))`, `spawn(process.execPath, [script])`), it runs the
script as node does (its arguments, `require.main`), not the application.

The executables of macOS are signed ad hoc. The ones of Windows made by Node.js keep the signature of `node.exe`, which
does not match anymore: sign them before distributing them.

### `lakutata package installer`

Make the installers of the application for the platform it runs on (as electron-builder): its executable in a directory
(`lakutata package exe --layout directory`) installed with its native addons and its resources, its program in the PATH,
its service registered. The installers of the other platforms are made on them (the ones of Linux in a container).
They are configured by the `lakutata.installer` of the `package.json`:

```json
"lakutata": {
  "installer": {
    "service": {"env": {"PORT": "8080"}},
    "linux": {"targets": ["deb", "rpm", "tar.gz"], "depends": []}
  }
}
```

| Option | |
|---|---|
| `name` | the name of the package (lower case), the one of the program by default |
| `appId` | the identifier of the application (reverse DNS, `com.acme.app`), its name by default: the identifier of the package of macOS and the label of its service, the key of its uninstaller and of its upgrades on Windows |
| `productName` | the name shown to the users (the installers, the programs of Windows), its name by default |
| `description`, `maintainer`, `homepage`, `license`, `vendor` | the ones of the `package.json` by default (the maintainer is its author) |
| `runtime` | the runtime of the executable: `node` (by default) or `bun`; `electron` for an Electron application (below) |
| `addToPath` | the program in the PATH (`/usr/bin/<program>`, the PATH of the machine on Windows), by default |
| `service` | `true` or the options of the service (below), none by default |
| `linux.targets` | `deb`, `rpm`, `archlinux`, `tar.gz` on the systems of the glibc (`deb`, `rpm`, `tar.gz` by default), `apk`, `tar.gz` on Alpine (musl) |
| `linux.depends`, `linux.recommends`, `linux.section`, `linux.priority` | the packages of the system it needs, recommends, its section and priority (deb) |
| `mac.targets` | `pkg`, `tar.gz` (both by default) |
| `win.targets` | `nsis`, `msi`, `zip` (all by default) |
| `electron` | the configuration of electron-builder of an Electron application, merged over the one made from these options |

The packages of Linux are made by nFPM (downloaded once into the cache of lakutata, `LAKUTATA_NFPM` gives another one),
in `dist/installer` (`--outdir`): the application is installed in `/opt/<name>`, the C++ library of the runtime is a
dependency. The executables link the C library of the system they are made on: the packages of the systems of the glibc
are made on one of them, the `apk` packages on Alpine, with Bun (`"runtime": "bun"`) when the application has native
addons: the executables of Node.js do not load them on musl.

The installers of macOS are made by its tools (`pkgbuild`, `productbuild`): the `pkg` package installs the application in
`/usr/local/lib/<name>`, its program in `/usr/local/bin`; the packages of macOS are not removed by the system:
`sudo /usr/local/lib/<name>/uninstall` removes it. They are signed ad hoc (the Developer ID signature and the
notarization, which the distribution out of the machines of the organization needs, are not made yet).

The installers of Windows are made on Windows: the installer of NSIS (`<name>-<version>-<arch>-setup.exe`) and the
package of Windows Installer (`.msi`, made by WiX, for the deployments of the organizations) install the application in
`C:\Program Files\<name>`, its data in `C:\ProgramData\<name>`; they are removed as the programs of Windows. Their tools
are downloaded once into the cache of lakutata (NSIS 3, WiX 3, WinSW; `LAKUTATA_NSIS`, `LAKUTATA_WIX`, `LAKUTATA_WINSW`
give other ones). The executables keep the signature of Node.js, which does not match anymore: sign them (signtool)
before distributing them.

The service runs the application at the start of the system: systemd (`/usr/lib/systemd/system/<service>.service`),
OpenRC on Alpine (`/etc/init.d/<service>`), launchd on macOS (`/Library/LaunchDaemons/<appId>.plist`), or WinSW on Windows
(`<name>-service.exe` next to the application, a service of Windows: `Restart-Service <service>`). It is started by the
installation, restarted by the upgrades, stopped and disabled before the removal.

| Service option | |
|---|---|
| `name`, `description` | the ones of the package by default |
| `args` | the arguments of the application |
| `env` | its environment (`MODE=production` by default), written to `/etc/<name>/<name>.env` (`/usr/local/etc/<name>/<name>.env` on macOS, `C:\ProgramData\<name>\<name>.env` on Windows), which the administrators change (kept by the upgrades) |
| `user` | its user: a system user named after the package by default (`_<name>` on macOS, hidden), created by the installation, or `root`; on Windows its virtual account by default (`NT SERVICE\<service>`), `LocalService`, `NetworkService` or `LocalSystem` |
| `restart` | `on-failure` (by default), `always` or `no` |
| `autoStart` | enabled and started by the installation, by default |

Its working directory is `/var/lib/<name>` (`/usr/local/var/lib/<name>` on macOS, its log `/usr/local/var/log/<name>.log`;
`C:\ProgramData\<name>` on Windows, its logs in `logs`), owned by its user (its data). `SIGTERM` ends it gracefully (on
Windows, the stop of the service: Ctrl+C, `SIGINT` for Node.js).

The executables load the environment file given by the `LAKUTATA_ENV_FILE` environment variable before the application
starts (the service of Windows, whose wrapper has none): its lines `NAME=value` or `NAME="value"`, its comments (`#`).

The installers run the scripts of the application (files of the project), as the ones of electron-builder: the ones of a
platform, which its installers run, replaced by the ones of an installer (a moment each), the native ones of a package of
Linux, the file of NSIS included by its installer:

```json
"installer": {
  "linux": {
    "scripts": {"preinstall": "build/linux/preinstall.sh", "postinstall": "build/linux/postinstall.sh", "preremove": "build/linux/preremove.sh", "postremove": "build/linux/postremove.sh"},
    "rpm": {"scripts": {"postinstall": "build/linux/rpm-postinstall.sh"}},
    "deb": {"nativeScripts": {"postinstall": "build/linux/postinst.sh"}}
  },
  "mac": {"scripts": {"postinstall": "build/mac/postinstall.sh"}},
  "win": {"scripts": {"postinstall": "build/win/postinstall.ps1"}, "nsis": {"include": "build/win/installer.nsh"}}
}
```

| Script | |
|---|---|
| `preinstall` | before the files of the application are installed (on Windows Installer, an upgrade has removed the version it replaces) |
| `postinstall` | after they are installed, before the service is started (on an upgrade, the one of the version replaced may still run) |
| `preremove` | before the removal, once the service is stopped |
| `postremove` | after the files are removed |

They are given what the installer does: `install` or `upgrade` (`preinstall`, `postinstall`), `remove` (`preremove`,
`postremove`; an upgrade runs no removal script), as their first argument (`$1`, `$args[0]` in PowerShell), and the
directory of the application (`LAKUTATA_INSTALL_DIR`). They run as root (as the system on Windows). Their failure is the
one of the installation (or of the removal). Each package manager tells it in its own way (dpkg `configure <version>`,
rpm the number of the versions, apk and pacman their upgrade scripts): the installers translate them.

- Linux (`linux.scripts`, `linux.<deb|rpm|apk|archlinux>.scripts`): scripts run by the interpreter of their first line
  (`#!/bin/sh` by default), embedded in the scripts of the packages. `linux.<package>.nativeScripts` are run as the
  package manager runs the scripts of the package, with its own arguments (`preinstall`, `postinstall`, `preremove`,
  `postremove`; `preupgrade`, `postupgrade` for apk and archlinux).
- macOS (`mac.scripts`, `mac.pkg.scripts`): sh scripts as on Linux; the removal ones are run by the `uninstall` script of
  the application (the packages of macOS are not removed by the system).
- Windows (`win.scripts`, `win.<nsis|msi>.scripts`): scripts of PowerShell (`.ps1`, run by Windows PowerShell; Windows
  Installer runs them by a command line, which they must fit in: about 23 KB each). `win.nsis.include` is a file of NSIS
  (`.nsh`) included by the installer of NSIS, whose macros are inserted: `customHeader`, `customInit`, `customInstall` (at
  the end of the installation), `customUnInit`, `customUnInstall` (at the start of the removal).
- The archives (`tar.gz`, `zip`) run none.

The installers of an Electron application (`"runtime": "electron"`) are made by electron-builder (a dependency of the
project): its main process bundled with its dependencies (Electron left out) in the archive of the application, its
native addons and its resources (`lakutata.resources`: its renderer, its preload script, read from `resourcesPath()`)
next to it, in the resources of Electron. Its installers are the targets of electron-builder (`deb` on Linux, `dmg` on
macOS, `nsis` on Windows by default: `linux.targets`, `mac.targets`, `win.targets`); `name`, `appId`, `productName`, its
description, maintainer, homepage and license are given to electron-builder, `electron` gives the rest (its icons, its
file associations, its signature, its updates…). It is not a service. Its scripts are run by:

| Installer | Scripts |
|---|---|
| `deb`, `rpm` (the packages of fpm) | all (embedded after the scripts of electron-builder) |
| `pkg` (macOS) | `preinstall`, `postinstall` (an application of macOS is removed by its user) |
| `nsis` (Windows) | `preinstall`, `postinstall`, `preremove` (its uninstaller ends with the removal of the files); the file of NSIS of `win.nsis.include` defines the other macros |
| the others (`AppImage`, `dmg`, `portable`, `msi`…) | none |

The packages of fpm made on Linux arm64 need the fpm of the system (`gem install fpm`, `USE_SYSTEM_FPM=true`): the one
electron-builder downloads is the one of x64. On Windows arm64, the installers of NSIS filter the executables by the BCJ
filter (`ELECTRON_BUILDER_7Z_FILTER`): the ARM64 one, which 7-Zip chooses, is not extracted by them.

| Command option | |
|---|---|
| `--target <targets...>` | the installers made, the ones of the configuration by default |
| `--outdir <directory>` | the directory of the installers, `dist/installer` by default |
| `--entry`, `--no-minify`, `--external` | as `lakutata package bundle` |

## Migrations

### `lakutata migration <action>`

The migrations of the databases of the application (its Database components and providers): `generate`, `run`, `revert`
and `show` run the script of the package building and starting the application (`dev` by default) with an environment
variable (`MIGRATION_GENERATE`, `MIGRATION_RUN`, `MIGRATION_REVERT`, `MIGRATION_SHOW`): the application connects its
databases with their options, without synchronizing their schemas nor running their migrations, does the command,
tells what it did and exits, without starting its components nor its entrypoints. `create` writes a file.

| Action | |
|---|---|
| `generate` | the migrations of the changes of the entities: the application compares them with its databases and writes the migrations into the directory, one file `<timestamp>-<name of the database>.ts` per database changed (`cross-env MIGRATION_GENERATE=./src/migrations npm run dev` of lakutata 2.x); without change, nothing is generated and the command fails |
| `create <name>` | an empty migration, written by hand (`up` and `down`): `<timestamp>-<name>.ts`, its class `<Name><timestamp>` |
| `show` | the migrations of the options of the databases, run `[X]` or pending `[ ]` |
| `run` | the pending migrations (`up`) |
| `revert` | the last migration run (`down`), one at a time; the application having several databases, `--database` is required |

| Option | |
|---|---|
| `--dir <directory>` | the directory of the migrations, relative to the package, `src/migrations` by default (`generate`, `create`) |
| `--script <script>` | the script building and starting the application, `dev` by default |
| `--package <name>` | the package of the workspace of the application, run from the workspace (the current directory by default) |
| `--database <name>` | the database: the name of its Database component or provider, all by default (`MIGRATION_DATABASE`) |
| `--transaction <mode>` | the transactions of the migrations run or reverted: `all` (one, by default), `each` or `none` (`MIGRATION_TRANSACTION`) |
| `--fake` | mark the migrations as run or reverted without executing them (`MIGRATION_FAKE`) |

The migrations are compiled with the application and given to the options of their database (`migrations: [...]`,
run when it connects with `migrationsRun: true`). The commands fail (exit code 1) when the application has no database
(but `generate`, which generates nothing), when the database given is not one of the application, and when a migration
fails.

## Languages

### `lakutata i18n <action> [locale]`

The messages of the languages of the application (`lakutata/com/i18n`), in a directory (`--dir`, `locales` by
default; several separated by commas): a file by language (`zh-CN.json`) or a directory by language (`zh-CN/`).

- `lakutata i18n check`: checks the messages of the languages against the ones of the default language (`--default`,
  `en` by default), and fails on their errors:
  - errors: a syntax error of ICU MessageFormat, a key the default language does not have, an argument the default
    message does not have (missing when the message is formatted), a validation message of an unknown code or with the
    variables of another code;
  - warnings: a message missing (the one of a fallback is given), an argument of the default message not used, a
    message the same as the default one (not translated yet). `--strict` fails on them too, for the CI.
- `lakutata i18n types`: declares the keys of the messages of the default language and their arguments
  (`--out`, `src/i18n.d.ts` by default): a key misspelled or an argument missing is then an error of the compilation.
  `--module @lakutata/i18n` declares them for the applications importing `@lakutata/i18n` rather than
  `lakutata/com/i18n`.
- `lakutata i18n add <locale>`: adds a language, made of the messages of the default language, as a file or a directory
  as the default language has (its validation messages left: the language has its built-in ones). They are to be
  translated; `check` tells the ones which are not.

## The language of the tool

The help of the tool (the descriptions of its commands and of their options) and its prompts are in English, Chinese
(Simplified, `zh-CN`) or Chinese (Traditional, `zh-TW`): the language of `LAKUTATA_LANG` (`LAKUTATA_LANG=zh-CN`), then
of the environment (`LC_ALL`, `LC_MESSAGES`, `LANG`), then of the system; English otherwise. The names of the commands
and of the options, the results and the errors are in English.

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (`npm_config_registry`, or `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a mirror of GitHub for the `github:` templates (`https://github.com`) |
| `LAKUTATA_CACHE_DIR` | the directory of the cache (`$XDG_CACHE_HOME/lakutata`, or `~/.cache/lakutata`) |
| `LAKUTATA_LANG` | the language of the help and of the prompts of the tool (`zh-CN`, `zh-TW`, `en`), the one of the environment by default |

The tool is itself a lakutata application: its commands are the CLI actions of a controller, served by the commander
adapter of the entrypoint.
