# @lakutata/cli

English | [中文](README.zh-CN.md)

The command line tool of the [lakutata](https://github.com/lakutata/lakutata) framework.

```bash
npx @lakutata/cli create --name my-app
# or installed: npm install -g @lakutata/cli
lakutata create --name my-app
```

## Commands

### `lakutata create`

Create a project from a template. The options are given on the command line. In a terminal, the tool asks for the
name when it is missing, offers the features of the template, and creates the project once you confirm (`--yes` skips
both the features and the confirmation).

| Option | |
|---|---|
| `--name <name>` | the name of the application (required) |
| `--id <id>` | the ID of the application (a package name), by default its name in lower case |
| `--template <template>` | the template (`default` when it is not given): an official template (listed by `lakutata templates`), `npm:<package>[@<version>]`, `github:<owner>/<repo>[#<ref>]` or a directory |
| `--path <directory>` | the directory in which the project directory is created, by default the current one |
| `--init` | create the project in the `--path` directory itself, which must exist and may hold files: the files it already has are kept (a warning lists those that the template also has, to merge by hand), and only the files the tool writes are filled with the information of the project |
| `--description`, `--author`, `--license` | information about the application |
| `--with <features>` | the optional features of the template to enable, separated by commas (listed by `lakutata templates`): `i18n`, `installer`. In a terminal, without `--with` or `--yes`, you choose them from a list |
| `--package-manager <npm\|pnpm\|yarn\|none>` | the package manager that installs the dependencies (`none` installs nothing): npm by default, or pnpm or yarn when one of them started the tool |
| `--no-git` | do not initialize a git repository |
| `--yes` | create the project without asking for the features or for a confirmation |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
lakutata create --name my-service --template service --with i18n --yes
```

Every official template has the `i18n` feature: the messages of the application in several languages
(`lakutata/com/i18n`), in `src/locales` (`en.json`, `zh-CN.json`) and bundled with the code. Each request is answered in
its own language, including its validation errors (command line tools and Electron applications use the language of the
environment). The feature also adds the `i18n:check` and `i18n:types` scripts. The `cli`, `service` and `web-*`
templates also have the `installer` feature: the `lakutata.installer` configuration of the application and the scripts
that make its installers (on the machine, and for Linux in Docker), and, in the `service` and `web-*` templates, a
system service.

### `lakutata templates`

List the official templates. They are npm packages (`@lakutata/template-<name>`), listed by the catalog package
`@lakutata/templates` and downloaded from the user's npm registry (a mirror such as npmmirror works, as it does for the
dependencies), so no access to GitHub is needed. The catalog is cached for a day (`--refresh` fetches it again).

The tool uses the newest release of an official template within its own major version. Downloaded templates are
cached: when the registry cannot be reached, the newest cached release of that major version is used, and without one
the command fails.

A template package keeps its files in its `template/` directory. npm packages cannot hold some files under their real
names, so `_gitignore`, `_npmrc`… are renamed `.gitignore`, `.npmrc`… when the project is created. The text files are
filled with the information of the project: `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`,
`{$APP_LICENSE}` and `{$LAKUTATA_VERSION}` (the version of the framework).

A template can have optional features, which `lakutata create --with <features>` enables (or which the user chooses in
a terminal):

- the `package.json` of the template package declares them, with their names and descriptions:
  `"lakutata": {"template": "default", "features": {"i18n": "The messages in several languages"}}`;
- the files of a feature are in `features/<name>/`, beside `template/` (and published with it, in the `files` of the
  package). They are added to the project when the feature is enabled: a JSON file that the project already has is
  merged into it (its objects merged by key, such as the scripts of `package.json` and the options of `tsconfig.json`,
  and its arrays replaced), and any other file replaces the one of the template;
- the files of the template can hold blocks for a feature: the lines between `//@if <feature>` and `//@end` (or
  `//@else`; `//@if !<feature>` for when the feature is not enabled) are kept when the feature is enabled and removed
  otherwise, and the marker lines are always removed. The markers are written as comments of the file's language:
  `//@if i18n`, `#@if i18n`, `<!--@if i18n-->`, `/*@if i18n*/`.

### `lakutata info`

Show the versions of the tool and of the framework (with their latest versions), of Node.js, and the version of the
framework that the project in the current directory uses.

### `lakutata clean [paths...]`

Remove paths of the package in the current directory, on every platform (like `rm -rf`, without `shx` or `rimraf`):
`lakutata clean build dist`. Without paths, it removes the output directories of its `tsconfig.json` (`outDir`, and
`declarationDir` when there is one, following the configurations it extends): `"clean": "lakutata clean"`. A missing
path is skipped. Paths outside the package, the package itself, `src`, `node_modules`, `.git` and `package.json` are
never removed. In a workspace, `lakutata run clean` runs the `clean` script of each package.

## Workspaces

Projects made of several packages (`app`, `ui`, `proxy`…) are npm workspaces. The workspace of a directory is the
nearest one, from that directory up, whose `package.json` has a `workspaces` field (a list of patterns, or
`{"packages": [...]}`), or whose `package.json` is next to a `pnpm-workspace.yaml` (its `packages:` list). The patterns
match directories (`*` within one name, `**` any number of directories, `!` leaves one out), and the ones holding a
`package.json` with a name are the packages. The tool builds and versions their packages: it covers the part of lerna
that these projects use, without lerna.

### `lakutata run <script>`

Run a script in every package that has it, in the order of their dependencies (in `dependencies`, `devDependencies`,
`peerDependencies` and `optionalDependencies`): a package starts once the packages it depends on, directly or not, have
finished, and packages that do not depend on each other run at the same time. The scripts run with the package manager
of the project: the `packageManager` field of the root `package.json`, else the files at the root (`pnpm-lock.yaml` or
`pnpm-workspace.yaml` for pnpm, `yarn.lock`, `package-lock.json`); npm by default. Each line of output starts with the
name of its package. The scripts take no extra arguments. When no package has the script, the command says so and
succeeds.

| Option | |
|---|---|
| `--concurrency <n>` | how many packages run at a time, by default the number of processors |
| `--parallel` | run all the packages at once, without waiting for their dependencies: for scripts that keep running (`lakutata run dev --parallel`) |
| `--no-bail` | go on after a failure: the packages that do not depend on a failed one still run (by default, no package starts after the first failure, and the ones running finish) |
| `--scope <names...>` | only the packages with these names (`*` is a wildcard); the packages they depend on are neither run nor waited for, and a scope matching no package is an error |

### `lakutata version <bump>`

Give every package the next version (`major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, or a
version; `--preid <id>` names the prerelease of the `pre…` bumps), the private packages and the ones without a version
included, and update the dependencies between them, in the packages and the root `package.json` (`^0.0.16` becomes
`^0.0.17`, and so do `~`, `>=`, `=` and `workspace:^` ranges, while `*`, `workspace:*` and `file:` are kept). With `0.x`
versions this matters, as a range matches only its own version. The command also updates `package-lock.json` or
`pnpm-lock.yaml`, without which `npm ci` would fail. A `yarn.lock` is not updated (the command warns you to run
`yarn install`), and a failed update is only a warning. The version of the workspace is the `version` of `lerna.json`
when that file gives one, else that of the root `package.json`, else the highest version of the packages, a prerelease
included (`0.0.0` when none has one), and the new version is written back there. `--git` commits the files of the
version, and only them, with the message `v<version>`, and tags the commit `v<version>` (a lightweight tag, not pushed);
the repository and the tag are checked before a file is changed. The command asks for a confirmation in a terminal only,
and `--yes` gives the version without asking.

### `lakutata add <name>`

Add a package to the workspace, in its directory of packages (without its scope): the directory of the first pattern of
the workspace of the form `<directory>/*`, such as `apps/*`, or `packages/*` when there is one, so that the other
commands see the package; a workspace without such a pattern (its packages named one by one, or `packages/**`) is
refused. Its version is that of the workspace (`lerna.json`, else the root `package.json`, else the highest version of
the packages; `0.0.1` without one, or with the independent versions of lerna). It is private (remove `"private": true`
to publish it), has `clean`, `build`, `rebuild` and `test` scripts and a test, and `--to <package>` adds it to the
dependencies of another package of the workspace, as `^<version>`. The command installs nothing: run the install of the
package manager of the project afterwards, as its output says, to link the package.

- `lakutata add greeting`: a TypeScript package (`src/index.ts` compiled into `build`, with its declarations).
- `lakutata add @acme/capture --native [gyp|cmake|rust]`: a native addon, with one of these build systems:
  - `gyp` (the default): C++ with [node-addon-api](https://github.com/nodejs/node-addon-api), built by node-gyp from
    `binding.gyp`;
  - `cmake`: C++ with node-addon-api, built by [cmake-js](https://github.com/cmake-js/cmake-js) from `CMakeLists.txt`;
  - `rust`: Rust with [napi-rs](https://napi.rs), built by cargo (`Cargo.toml`, `build.rs`, `rust/lib.rs`).

  Node-API is stable across versions of Node.js and Electron, so the same addon runs in both without being rebuilt. The
  addon is built into `build/Release` (by `npm run build:native`, and by its `install` script when the package is
  installed) and loaded by node-gyp-build from `src/index.ts`, which is compiled into `dist`. The C++ addons are built
  for Intel and Apple silicon Macs in one file, a Rust addon for the architecture of the machine. `lakutata native`
  links their libraries. The comments of `binding.gyp` and `CMakeLists.txt` also show how to give libraries and build
  options: system libraries, pkg-config, static libraries of the package, dynamic libraries shipped with the addon
  (copied next to it and found there through its rpath), and in `binding.gyp` the C++ standard and the options of each
  platform (`CMakeLists.txt` sets C++20). A library with its own Makefile is built before the addon by a script, as the
  README of the package shows (`build:deps`). `lakutata package bundle` and `lakutata package exe` ship the addon, and
  its dynamic libraries, with the application. Building it needs a C++ toolchain (with CMake for `cmake`), or Rust for
  `rust`.

### `lakutata native <action> <value>`

Change the build of the native addon in the current directory, found by its build file (`binding.gyp`,
`CMakeLists.txt` or `Cargo.toml`). The file is edited in place, keeping its comments and layout; the sources of the
addon are not changed. Repeating a change changes nothing.

- `lakutata native link <library>`: link a library:
  - a system library: `lakutata native link pcap` (`ws2_32` with `--platform win`);
  - `--pkg-config`: a library found by pkg-config (`lakutata native link libpcap --pkg-config`; not on Windows);
  - `--framework`: a macOS framework (`lakutata native link CoreFoundation --framework`);
  - a file of the package: a static library (`deps/lib/libfoo.a`; `foo.lib` on Windows) is linked into the addon; a
    dynamic library (`deps/lib/libfoo.dylib`, `libfoo.so`, or `foo.dll` with its import library `foo.lib`) is copied
    next to the addon and found there at run time through its rpath (`@loader_path` on macOS, `$ORIGIN` on Linux). On
    macOS, its install name must be `@rpath/libfoo.dylib` (set with `install_name_tool -id`): the command says so when
    it is not;
  - `--crate`: a crate, for a Rust addon (`cargo add`).
- `lakutata native include <directory>`: a directory of headers (C++), of the package or an absolute directory of the
  system.
- `lakutata native define <NAME[=value]>`: a preprocessor definition (C++).

`--platform mac|linux|win` makes the change for one platform only (a library file sets its own platform: `.dylib` macOS,
`.so` Linux, `.dll` and `.lib` Windows, `.a` every platform but Windows, like pkg-config). `--target <name>` names the
target to change when the build file has several. What is written, by build system:

| | gyp | CMake | Rust |
|---|---|---|---|
| File | `binding.gyp`, or the `.gypi` it includes that declares the target | `CMakeLists.txt` | `.cargo/config.toml` (`[env]`), read by `build.rs` |
| Library | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | the `-sys` crates |
| Framework | `xcode_settings.OTHER_LDFLAGS` | `-framework` in `if(APPLE)` | `rustc-link-lib=framework=` |
| Dynamic library | `copies`, the rpath | `INSTALL_RPATH` (`BUILD_WITH_INSTALL_RPATH`), a `POST_BUILD` copy | `rustc-cdylib-link-arg`, a copy in `build:native` |
| Headers, definitions | `include_dirs`, `defines` | `target_include_directories`, `target_compile_definitions` | none (crates) |
| Platform | `conditions` (`OS=="mac"`, `OS!="win"`) | `if(APPLE)`, `if(WIN32)`, `if(NOT WIN32)`, `if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`, `_LINUX`, `_WINDOWS`, `_UNIX` |

For a Rust addon, the libraries are passed to `build.rs` (written by `lakutata add --native rust`), which passes them
to cargo for the addon only: flags given to rustc would apply to every crate it builds.

### `lakutata list`

List the packages: the first line gives their number and the version of the workspace, then each package has its
version, ` (private)` when it is private, its directory and the packages of the workspace it depends on.

### From lerna

| lerna | lakutata |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git` (the tag is not pushed) |

Packages are still published with `npm publish -w <package>` (the packages `lakutata add` makes are private: remove
`"private": true` first). From `lerna.json`, the tool reads and writes only `version`: the packages come from the
`workspaces` of the root `package.json`, or from `pnpm-workspace.yaml`. It does not version packages independently (a
`lerna.json` with `"version": "independent"` cannot be bumped), write changelogs from the commits or cache builds:
workspaces that need these keep lerna (or nx, turborepo) alongside it.

## Native libraries

### `lakutata ffi generate <header>`

Generate the class of a native library of `@lakutata/ffi` from its C header: its declarations, a property by function
with its TypeScript type, an interface by struct and union, its integer macros as constants. The header is run through
the preprocessor of the C compiler (`cc -E`; `cl /P` on Windows, in the Developer Command Prompt of Visual Studio); the
declarations of the library are kept (the ones of the header, and of the headers of its directory unless it is a
directory of the system), with the types of the system they use. The functions are then checked against the library:
the ones it does not export, or that cannot be called (a `va_list` parameter), are left out. The command lists what
it left out and why. The tool loads `@lakutata/ffi` from the project: install it there.

| Option | |
|---|---|
| `--library <name or file>` | the library the functions are checked against: a name, as `@Library` takes it, or a file; the name of the header by default (`sqlite3.h`: `sqlite3`; zlib needs `--library z`). When it cannot be loaded, the class is generated without the check, with a warning |
| `--class-name <name>` | the name of the class, the name of the header in PascalCase by default |
| `--out <file>` | the file written, `<class>.ts` in the current directory by default |
| `--force` | replace the file when it exists |
| `--include <directories...>` | the directories of the headers it includes (`-I`) |
| `--define <macros...>` | the macros defined before it: `NAME` or `NAME=value` (`-D`) |
| `--own <directories...>` | more directories whose headers are the ones of the library |
| `--compiler <compiler>` | the C compiler whose preprocessor reads the header: `cc`, `gcc`, `clang`, `cl` (the one of `CC` by default, else `cl` on Windows and `cc` elsewhere) |
| `--no-check` | do not check the functions against the library |

The class is generated for the platform the command runs on. A header does not say which pointers are output
parameters, nor which functions block: mark them in the file generated (`_Out_`, `{async: true}`). See the guide to
native libraries ([FFI](https://lakutata.com/guide/FFI), section 9).

## Bundles and executables

These commands pack the application in the current directory, which must be compiled first (by `tsc`, which emits the
metadata of the decorators). The work is done by `@lakutata/builder`: the copy installed in the project
(`npm install --save-dev @lakutata/builder`, as the templates that pack their application do), else the one installed
with the tool (a global install of the tool does not include it, as the builder is an optional peer dependency). Scripts
can also pack applications with its functions (`bundleProject`, `buildExecutable`).

### `lakutata package bundle`

Bundle the application and its dependencies into one CommonJS file (with esbuild) that node runs without
`node_modules`: `dist/<name>.cjs`, where the name is the first `bin` of the `package.json`, else the package name
without its scope. The entry is the `main` of the `package.json`, else `build/App.js` (`--entry` changes it). The
bundle is minified, keeping the names of the classes (`--no-minify` turns minifying off), and `import.meta.url` is the
URL of the bundle.

| Option | |
|---|---|
| `--entry <file>` | the compiled entry, by default the `main` of the `package.json`, else `build/App.js` |
| `--outfile <file>` | the bundle, `dist/<name>.cjs` by default |
| `--no-minify` | do not minify the bundle |
| `--external <modules...>` | the modules left out of the bundle, loaded at run time from a `node_modules` next to it |

Bundles are CommonJS modules, because the executables of Node.js run them. The ES modules of the application are
converted, so they cannot use top-level `await`: await inside an async function instead.

Native addons (`.node` files) cannot be bundled. While bundling, the tool finds the packages that hold addons, and the
packages that load them through computed paths (such as sharp). It leaves them out of the bundle, with what they load at
run time (the JavaScript they require, and the packages of the shared libraries linked with their addons, such as
libvips), and lays them out as in `node_modules` in `dist/<name>.native/`, which is distributed with the bundle. This
tree holds the files loaded at run time: all the files of the packages of addons and shared libraries; for the other
packages, the JavaScript they load (traced) and their other files (the data they read); and all the files of the
packages that load their files through paths that cannot be followed (`require(path.join(__dirname, name))`). The type
declarations, source maps, TypeScript sources and documentation of the packages are left out, and so are the C and C++
sources and objects of the addons (better-sqlite3 holds the source of SQLite) and what built them: the files of node-gyp
and of CMake in `build/`, the `target` directory of cargo, the static and import libraries. The addons of the
application itself (`require('./x.node')`, `createRequire(import.meta.url)('./x.node')`) go into the tree too. The
packages of the framework, and those built on it, are always bundled with the application, whatever they depend on, so
that there is one copy of the framework, its classes and its container; their native dependencies go into the tree.
Optional dependencies that are not installed (the drivers of stores the application does not use: `peerDependenciesMeta`
optional, `optionalDependencies`) are left out: loading one throws at run time, as it would without the bundle.

The bundler does not follow the files that the application reads by path: the scripts it runs on their own (workers,
`new Worker()`, worker pools given a file; child processes, `fork()`; modules loaded by path,
`require(path.join(__dirname, 'x.js'))`) and its data (`fs.readFileSync(path.join(__dirname, 'defaults.json'))`, a
directory of schemas). Also, the bundle is not where the modules were: in a module of `build/config/`,
`path.resolve(__dirname, '../../schema')` is the `schema/` directory of the project, but no longer once bundled into
`dist/`. The tool finds every path to a file built from the location of its module, wherever it is written, in the
modules of the application and in those of its packages, and rewrites the expression to point to the file in the
native tree (`dist/<name>.native/.lakutata/files/`, with the directories as in the project, and the packages linked
from outside it under `node_modules/`):

| The path names | |
|---|---|
| a script (`.js`, `.cjs`) | bundled on its own with what it loads (as a CommonJS file, whatever the module type of the project) |
| another file | copied (a `package.json` gets the type CommonJS, like the scripts next to it) |
| a directory of data | its files copied |
| a directory holding the module (`path.join(__dirname, '..')`: the application, its packages) | not shipped, with a warning: declare its files as resources (`lakutata.resources`, below) |
| a directory holding scripts or packages (`package.json`, `node_modules`) | not shipped, with a warning: its scripts would need their packages at run time |
| nothing yet (a directory the application creates) | left as it is |

The paths that are followed:

| Path | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | the URL of the module (as in Vite); also `pathToFileURL(__filename)` |
| `import.meta.url + '/../worker.js'` | the URL of the module as a string |
| `path.join(__dirname, 'worker.js')`, `path.resolve(__dirname, …)` | also with `import.meta.dirname` or `path.dirname(fileURLToPath(import.meta.url))` |
| `__dirname + '/worker.js'`, `` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')`, `require.resolve(path.resolve(__dirname, '../lib/worker'))` | the extension is found as node finds it |
| `` path.join(__dirname, 'locales', `${lang}.json`) ``, `` new URL(`./jobs/${name}.js`, import.meta.url) `` | partly known: every file and directory its pattern matches (an expression matches part of a name), with the expression kept |

The code emitted by tsc (`(0, node_path_1.join)(__dirname, 'worker.js')`) is followed too. A script that the
application also imports gets a warning: it is bundled twice, with a separate copy of its module (its state, its
classes) in each. Node.js workers (`worker_threads`) whose scripts cannot be followed get a warning in the modules of
the application (packages start workers from the paths their users give): a path known only at run time
(`new Worker(file)`; a variable or a class property holding one of the paths above is followed), or a path relative
to the current directory of the process (`new Worker('./worker.js')`, which node resolves from there, not from the
module). Build the paths of their scripts from the directory of their module, or ship the scripts as resources.
Workers that run source code (`eval: true`) need nothing. The warnings name only the modules of the application,
with their file and line.

The resources of the application, the files it reads at run time (the built pages of a web application, templates,
data), are declared in the `lakutata.resources` of its `package.json`, as a list of `{from, to}` objects (like the
`extraResources` of electron-builder, but without its strings, globs or filters):

```json
"lakutata": {"resources": [{"from": "../ui/dist", "to": "ui"}]}
```

`from` is a file or a directory of the project, and `to` its path among the resources, in `dist/<name>.resources/`,
which is distributed with the bundle. The application finds them through `resourcesPath()` of lakutata (`undefined`
when it does not run packed, which `isPackaged()` tells).

### `lakutata package exe`

Make an executable of the application for the platform it runs on, which runs without Node.js installed: `dist/<name>`
(`dist/<name>.exe` on Windows). The bundle is embedded, with its V8 code cache, in a copy of the Node.js binary running
the tool (a single executable application of Node.js), so the embedded Node.js is the version running the tool. In an
executable, `import.meta.url` is the URL of the executable itself.

With `--runtime bun`, Bun compiles the bundle instead (`bun build --compile --bytecode`: the code is compiled to
bytecode, so it is not parsed at start), using the Bun of the project (the `bun` package of npm,
`npm install --save-dev bun`), else the one of the system. Its executables are smaller, start faster and use less
memory; the runtime is then Bun (JavaScriptCore, with its implementation of the Node.js APIs). The native addons are
those of Node.js, not rebuilt for Bun. Bun loads the addons of Node-API, but may not load those built on the V8 API of
Node.js: the tool warns of them (with better-sqlite3, the executable builds, and fails when it loads the package). Like
the executables of Node.js, the executables of Bun do not load the `.env` or the `bunfig.toml` of the directory they run
in (an application that needs one loads it itself, or uses `LAKUTATA_ENV_FILE`), and the mode is that of the run: Bun
would replace `process.env.NODE_ENV` with the mode of its build, but the bundle reads it at run time.

Make the executables of other platforms on those platforms: the native addons of the application are built there for
them, and the executables can be tested there. A CI provides the machines (a matrix of Linux, macOS and Windows
runners); the Linux architectures can also be built in a container of the architecture
(`docker run --platform linux/arm64`, as the cross builds of the templates do).

| Option | |
|---|---|
| `--outdir <directory>` | the directory of the executable, `dist` by default |
| `--runtime <node\|bun>` | the embedded runtime: `node` (the default) or `bun` |
| `--layout <file\|directory>` | one file (the default), or a directory: `dist/<name>/` holds the executable, its native addons (`native/`) and its resources (`resources/`), loaded from there without extraction (for the installers and the images) |
| `--entry`, `--no-minify`, `--external` | as for `lakutata package bundle`: the external modules are loaded from a `node_modules` next to the executable |

With `--layout file`, the native addons, the files read by path and the resources are embedded in the executable. At its
first run, the executable extracts them into `native/<hash>`, a directory named after their content, in its cache
directory: `~/Library/Caches/<name>` on macOS, `%LOCALAPPDATA%\<name>\Cache` on Windows, `$XDG_CACHE_HOME/<name>` or
else `~/.cache/<name>` on Linux, or the directory given by `LAKUTATA_NATIVE_DIR`. When the cache directory cannot be
written, it uses `<name>` in the temporary directory (not when `LAKUTATA_NATIVE_DIR` is given). The next runs load them
from there, and different versions of the program do not share it. The addons need the system libraries they were built
for (the glibc version of the Linux prebuilt addons).

The child processes of an executable run the executable itself (`process.execPath`). In both layouts, an executable
started for one of its scripts (`fork(path.join(__dirname, 'child.js'))`, `spawn(process.execPath, [script])`) runs that
script with its arguments, not the application: with Node.js, `require.main` is that script, as with node; with Bun, it
is not.

The executables for macOS are signed ad hoc. Those for Windows made with Node.js keep the signature of `node.exe`,
which no longer matches: sign them before distributing them.

### `lakutata package installer`

Make the installers of the application for the platform it runs on (as electron-builder does). They install its
executable in the directory layout (`lakutata package exe --layout directory`) with its native addons and its
resources, put its program in the PATH and register its service. Make the installers of other platforms on those
platforms (the Linux ones can be made in a container). They are configured by the `lakutata.installer` of the
`package.json`:

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
| `name` | the name of the package (lower case), by default that of the program (for an Electron application, the name of the package without its scope) |
| `appId` | the identifier of the application (reverse DNS, `com.acme.app`), by default its name: on macOS, the identifier of the package and the label of the service; on Windows, the key of its uninstaller and of its upgrades |
| `productName` | the name shown to users (in the installers, and in the list of programs on Windows), by default the `productName` of the `package.json`, else the name |
| `description`, `maintainer`, `homepage`, `license` | by default those of the `package.json` (the maintainer is its author) |
| `vendor` | its vendor, none by default (on Windows, the publisher is the vendor, else the maintainer) |
| `runtime` | the runtime of the executable: `node` (the default) or `bun`; `electron` for an Electron application (below) |
| `addToPath` | put the program in the PATH (`/usr/bin/<program>`, `/usr/local/bin/<program>` on macOS; on Windows, the PATH of the machine), `true` by default |
| `service` | `true` or the options of the service (below), none by default |
| `linux.targets` | `deb`, `rpm`, `archlinux`, `tar.gz` on glibc systems (`deb`, `rpm`, `tar.gz` by default); `apk`, `tar.gz` on Alpine (musl) |
| `linux.depends`, `linux.recommends`, `linux.section`, `linux.priority` | the system packages it needs and recommends, its section and its priority (deb) |
| `mac.targets` | `pkg`, `tar.gz` (both by default) |
| `win.targets` | `nsis`, `msi`, `zip` (all by default) |
| `electron` | the electron-builder configuration of an Electron application, merged over the one made from these options |

The configuration is checked before anything is built, the options of the installers that are not made included.

The Linux packages are made by nFPM (downloaded once into the cache of lakutata, for x64 and arm64; `LAKUTATA_NFPM`
gives another copy, and one for the other architectures) in `dist/installer` (`--outdir`). They install the application
in `/opt/<name>`, with the C++ runtime library as a dependency. The executables link the C library of the system they
are made on, so make the packages for glibc systems on a glibc system, and the `apk` packages on Alpine, with Bun
(`"runtime": "bun"`) when the application has native addons: the executables of Node.js do not load them on musl.

The macOS installers are made with the tools of macOS (`pkgbuild`, `productbuild`). The `pkg` package installs the
application in `/usr/local/lib/<name>` and its program in `/usr/local/bin`, on the Macs of the architecture of the
program only. macOS does not remove packages: `sudo /usr/local/lib/<name>/uninstall` removes the application (its data,
its environment file, its user and its log are kept). The `pkg` package is not signed, and the executable it installs is
signed ad hoc only (the Developer ID signature and the notarization, which distribution outside the machines of the
organization needs, are not made yet).

The Windows installers are made on Windows: the NSIS installer (`<name>-<version>-<arch>-setup.exe`) and the Windows
Installer package (`.msi`, made by WiX, for deployment in organizations) install the application in
`C:\Program Files\<name>` and its data in `C:\ProgramData\<name>`; they are removed like other Windows programs. Their
tools are downloaded once into the cache of lakutata (NSIS 3, WiX 3, WinSW; `LAKUTATA_NSIS`, `LAKUTATA_WIX` and
`LAKUTATA_WINSW` give other copies). The executables made with Node.js (`"runtime": "node"`) keep the signature of
Node.js, which no longer matches: sign them (signtool) before distributing them.

The service runs the application when the system starts: systemd (`/usr/lib/systemd/system/<service>.service`), OpenRC
on Alpine (`/etc/init.d/<service>`), launchd on macOS (`/Library/LaunchDaemons/<appId>.plist`), or WinSW on Windows
(`<name>-service.exe` next to the application, registered as a Windows service: `Restart-Service <service>`). The
installation starts it, an upgrade restarts it, and the removal stops and disables it first.

| Service option | |
|---|---|
| `name`, `description` | those of the package by default |
| `args` | the arguments of the application |
| `env` | its environment (`MODE=production` by default), written to `/etc/<name>/<name>.env` (`/usr/local/etc/<name>/<name>.env` on macOS, `C:\ProgramData\<name>\<name>.env` on Windows), which administrators may edit (upgrades keep it) |
| `user` | its user: by default a system user named after the package (`_<name>` on macOS, hidden), created by the installation, or `root`; on Windows, by default its virtual account (`NT SERVICE\<service>`), or `LocalService`, `NetworkService` or `LocalSystem` |
| `restart` | `on-failure` (the default), `always` or `no` (on Windows and with OpenRC, `on-failure` and `always` behave alike) |
| `autoStart` | enabled and started by the installation, `true` by default; otherwise the administrator enables and starts it (`systemctl enable --now <service>`; on macOS, `launchctl enable system/<appId>`, then `launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`) |

Its working directory, which holds its data and is owned by its user, is `/var/lib/<name>` (`/usr/local/var/lib/<name>`
on macOS, with its log in `/usr/local/var/log/<name>.log`; `C:\ProgramData\<name>` on Windows, with its logs in `logs`).
`SIGTERM` ends it gracefully (on Windows, stopping the service sends a Ctrl+C, which Node.js receives as `SIGINT`).

Every bundle and executable, and so every installed application, loads the environment file named by the
`LAKUTATA_ENV_FILE` environment variable before the application starts (the Windows service gets its environment this
way, as its wrapper has no environment file): lines `NAME=value` or `NAME="value"`, and comments (`#`). The values of
the file override the variables that are already set.

The installers run scripts of the application (files of the project), as with electron-builder: the scripts of a
platform, which all its installers run; the scripts of one installer, each replacing the platform's script for the
same moment; the native scripts of a Linux package; and an NSIS file included by the NSIS installer:

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
| `preinstall` | before the files of the application are installed (with Windows Installer, an upgrade has already removed the version it replaces) |
| `postinstall` | after they are installed, before the service starts (during an upgrade, the service of the version replaced may still run) |
| `preremove` | before the removal, once the service is stopped |
| `postremove` | after the files are removed |

Their first argument (`$1`, `$args[0]` in PowerShell) tells what the installer does: `install` or `upgrade`
(`preinstall`, `postinstall`), or `remove` (`preremove`, `postremove`; an upgrade runs no removal script).
`LAKUTATA_INSTALL_DIR` gives the directory of the application. They run as root (on Windows, as an administrator with
NSIS and as the system account with Windows Installer). When a script fails, the installation (or the removal) fails.
Each package manager signals an upgrade in its own way (dpkg with `configure <version>`, rpm with the number of
installed versions, apk and pacman with their upgrade scripts): the installers translate them into these arguments.

- Linux (`linux.scripts`, `linux.<deb|rpm|apk|archlinux>.scripts`): scripts run by the interpreter named on their first
  line (`#!/bin/sh` by default), embedded in the scripts of the packages. `linux.<package>.nativeScripts` are run the
  way the package manager runs the scripts of the package, with its own arguments (`preinstall`, `postinstall`,
  `preremove`, `postremove`; `preupgrade`, `postupgrade` for apk and archlinux).
- macOS (`mac.scripts`, `mac.pkg.scripts`): sh scripts, as on Linux; the `uninstall` script of the application runs
  the removal scripts (macOS does not remove packages).
- Windows (`win.scripts`, `win.<nsis|msi>.scripts`): PowerShell scripts (`.ps1`, run by Windows PowerShell; Windows
  Installer runs them through a command line, which each must fit in: about 23 KB). `win.nsis.include` is an NSIS file
  (`.nsh`) included by the NSIS installer, which inserts its macros: `customHeader`, `customInit`, `customInstall` (at
  the end of the installation), `customUnInit`, `customUnInstall` (at the start of the removal).
- Archives (`tar.gz`, `zip`) run no scripts.

The installers of an Electron application (`"runtime": "electron"`) are made by electron-builder, a dependency of the
project. Its main process is bundled with its dependencies (Electron left out) into the archive of the application, and
its native addons and resources (`lakutata.resources`: its renderer and its preload script, read from `resourcesPath()`)
go next to it, in the resources of Electron. Its installers are targets of electron-builder (by default `deb` on Linux,
`dmg` on macOS and `nsis` on Windows: `linux.targets`, `mac.targets`, `win.targets`). `name`, `appId`, `productName`,
the description, maintainer, homepage and license are given to electron-builder, and `electron` gives the rest (icons,
file associations, signature, updates…); `addToPath` and the `linux` options other than `targets` and the scripts are
not used, and `vendor` is used on Linux only. Its native addons are copied as they are installed (electron-builder does
not rebuild them): the addons of Node-API run in Electron as they are; install the Electron builds of the others before
packing (`electron-rebuild`). An Electron application is not a service. Its scripts are run by:

| Installer | Scripts |
|---|---|
| `deb`, `rpm` (packages made by fpm) | all (`postinstall` and `postremove` after the scripts of electron-builder) |
| `pkg` (macOS) | `preinstall`, `postinstall` (a macOS application is removed by its user) |
| `nsis` (Windows) | `preinstall`, `postinstall`, `preremove` (its uninstaller ends by removing the files); the NSIS file of `win.nsis.include` defines the other macros |
| the others (`AppImage`, `dmg`, `portable`, `msi`…) | none |

On Linux arm64, the fpm packages need the fpm of the system (`gem install fpm`, `USE_SYSTEM_FPM=true`), because the
one electron-builder downloads is built for x64. On Windows arm64, the NSIS installers compress the executables with
the BCJ filter (`ELECTRON_BUILDER_7Z_FILTER`), because they cannot extract files compressed with the ARM64 filter,
which 7-Zip would choose.

| Command option | |
|---|---|
| `--target <targets...>` | the installers to make, by default those of the configuration |
| `--outdir <directory>` | the directory of the installers, `dist/installer` by default |
| `--entry`, `--no-minify`, `--external` | as for `lakutata package exe` |

## Migrations

### `lakutata migration <action>`

Manage the migrations of the databases of the application (its Database components and providers). `generate`, `run`,
`revert` and `show` run the package script that builds and starts the application (`dev` by default, run by the package
manager of the project) with an environment variable (`MIGRATION_GENERATE`, `MIGRATION_RUN`, `MIGRATION_REVERT`,
`MIGRATION_SHOW`). The application then connects to its databases with their options, without synchronizing their
schemas or running their migrations, runs the command, reports what it did and exits, without starting its components or
its entrypoints. `create` only writes a file.

| Action | |
|---|---|
| `generate` | migrations for the changes of the entities: the application compares the entities with its databases and writes the migrations into the directory, one file `<timestamp>-<database name>.ts` per changed database (what `cross-env MIGRATION_GENERATE=./src/migrations npm run dev` did in lakutata 2.x); when nothing changed, nothing is generated and the command fails |
| `create <name>` | an empty migration to write by hand (`up` and `down`): `<timestamp>-<name>.ts`, with the class `<Name><timestamp>` |
| `show` | the migrations in the options of the databases, run (`[X]`) or pending (`[ ]`) |
| `run` | the pending migrations (`up`) |
| `revert` | the last migration run (`down`), one at a time; when the application has several databases, `--database` is required |

| Option | |
|---|---|
| `--dir <directory>` | the directory of the migrations, relative to the package, `src/migrations` by default (`generate`, `create`) |
| `--script <script>` | the script that builds and starts the application, `dev` by default |
| `--package <name>` | the package of the application in the workspace, when the command runs from elsewhere in the workspace (by default, the package in the current directory) |
| `--database <name>` | the database: the name of its Database component or provider, all of them by default (`MIGRATION_DATABASE`) |
| `--transaction <mode>` | the transactions of the migrations run or reverted: `all` (one for all), `each` or `none`; by default the `migrationsTransactionMode` of the database, else `all` (`MIGRATION_TRANSACTION`) |
| `--fake` | mark the migrations as run or reverted without executing them (`MIGRATION_FAKE`) |

The migrations are compiled with the application and listed in the options of their database (`migrations: [...]`;
they run when it connects with `migrationsRun: true`). The commands fail (exit code 1) when the application has no
database (except `generate`, which then generates nothing), when the given database is not one of the application,
and when a migration fails.

## Languages

### `lakutata i18n <action> [locale]`

Manage the messages of the languages of the application (`lakutata/com/i18n`), kept in a directory (`--dir`, `locales`
by default; several separated by commas) with one file (`zh-CN.json`) or one directory (`zh-CN/`) per language.

- `lakutata i18n check`: checks the messages of each language against those of the default language (`--default`,
  `en` by default), and fails on errors:
  - errors: an ICU MessageFormat syntax error, a key the default language does not have, an argument the default
    message does not have (missing when the message is formatted), a validation message with an unknown code or with
    the variables of another code;
  - warnings: a missing message (the message of a fallback language is given instead), an argument of the default
    message that is not used, a message identical to the default one (not translated yet). `--strict` fails on
    warnings too, for CI.
- `lakutata i18n types`: declares the message keys of the default language and their arguments (`--out`,
  `src/i18n.d.ts` by default), so that a misspelled key or a missing argument is a compile error.
  `--module @lakutata/i18n` declares them for applications that import `@lakutata/i18n` rather than
  `lakutata/com/i18n`.
- `lakutata i18n add <locale>`: adds a language as a copy of the messages of the default language, in a file or a
  directory like the default language (without its validation messages: the language has built-in ones). Translate
  them; `check` reports the ones that are not translated yet.

## The language of the tool

The help of the tool (the descriptions of its commands and options), its prompts, the validation errors of the
options and a few results (the plan of `lakutata version`, a declined confirmation) are in English, Simplified Chinese
(`zh-CN`) or Traditional Chinese (`zh-TW`). The language comes from `LAKUTATA_LANG` (`LAKUTATA_LANG=zh-CN`), then from
the environment (`LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`), then from the system; English is used when none of them
matches. The names of the commands and options, and the other results and errors, are in English.

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (by default `npm_config_registry`, else `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a GitHub mirror for the `github:` templates (`https://github.com` by default) |
| `LAKUTATA_CACHE_DIR` | the cache directory (by default `$XDG_CACHE_HOME/lakutata`, else `~/.cache/lakutata`) |
| `LAKUTATA_LANG` | the language of the tool (`zh-CN`, `zh-TW`, `en`), by default that of the environment |

The tool is itself a lakutata application: its commands are the CLI actions of its controllers, served by the
commander adapter of the entrypoint.

## See also

- The guides on the website: [Command Line Tool](https://lakutata.com/guide/Command) and
  [Workspaces](https://lakutata.com/guide/Workspaces).
