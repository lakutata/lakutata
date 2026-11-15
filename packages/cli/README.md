# @lakutata/cli

English | [中文](README.zh-CN.md)

The command-line tool of the [Lakutata](https://github.com/lakutata/lakutata) framework.

```bash
npx @lakutata/cli create --name my-app
# or installed: npm install -g @lakutata/cli
lakutata create --name my-app
```

## Commands

### `lakutata create`

Create a project from a template. The options are specified on the command line. In a terminal, the tool asks for the
name when it is missing, offers the template's features, and creates the project once you confirm (`--yes` skips both
the features and the confirmation).

| Option | |
|---|---|
| `--name <name>` | the application's name (required) |
| `--id <id>` | the application's ID (a package name), by default its name in lower case |
| `--bundle-id <id>` | for the mobile templates, the application's ID on mobile systems (a reverse domain name such as `com.acme.shop`); `com.example.<name>` by default, which the stores refuse |
| `--template <template>` | the template (`default` when it is not specified): an official template (listed by `lakutata templates`), `npm:<package>[@<version>]`, `github:<owner>/<repo>[#<ref>]` or a directory |
| `--path <directory>` | the directory in which the project directory is created, by default the current one |
| `--init` | create the project in the `--path` directory itself, which must exist and may contain files: its existing files are kept (a warning lists those that the template also has, to merge manually), and only the files the tool writes are filled with the project's information |
| `--description`, `--author`, `--license` | information about the application |
| `--with <features>` | the template's optional features to enable, separated by commas (listed by `lakutata templates`): `i18n`, `installer`, `win7`. In a terminal, without `--with` or `--yes`, you choose them from a list |
| `--package-manager <npm\|pnpm\|yarn\|none>` | the package manager that installs the dependencies (`none` installs nothing): npm by default, or pnpm or yarn when one of them started the tool |
| `--no-git` | do not initialize a git repository |
| `--yes` | create the project without asking for features or confirmation |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
lakutata create --name my-service --template service --with i18n --yes
```

Every official template has the `i18n` feature: the application's messages in several languages (`lakutata/com/i18n`),
in `src/locales` (`en.json`, `zh-CN.json`) and bundled with the code. Each request receives a response in its own
language, including its validation errors (command-line tools and desktop applications use the environment's language).
The feature also adds the `i18n:check` and `i18n:types` scripts. The `cli`, `service` and `web-*` templates also have
the `installer` feature: the application's `lakutata.installer` configuration and the scripts that build its installers
(on the machine, and for Linux in Docker), and, in the `service` and `web-*` templates, a system service. The `nwjs-*`
templates have the `win7` feature: NW.js 0.72.0, the last release that runs on Windows 7, 8 and 8.1, instead of the
release the template was published with, and the script that builds installers for 32-bit Windows.

### `lakutata templates`

List the official templates. They are npm packages (`@lakutata/template-<name>`), listed by the catalog package
`@lakutata/templates` and downloaded from the user's npm registry (a mirror such as npmmirror works, as it does for the
dependencies), so no access to GitHub is needed. The catalog is cached for a day (`--refresh` fetches it again).

The tool uses the newest release of an official template within its own major version. Downloaded templates are
cached: when the registry cannot be reached, the newest cached release of that major version is used, and without one
the command fails.

A template package keeps its files in its `template/` directory. npm packages cannot contain some files under their real
names, so `_gitignore`, `_npmrc`… are renamed `.gitignore`, `.npmrc`… when the project is created. Text files are filled
with the project's information: `{$APP_NAME}`, `{$APP_ID}`, `{$APP_DESC}`, `{$APP_AUTHOR}`, `{$APP_LICENSE}` and
`{$LAKUTATA_VERSION}` (the framework's minor version, `3.1.0` for 3.1.2; a patch releases only the packages it changes,
so `^{$LAKUTATA_VERSION}` matches every Lakutata package).

A template can have optional features, which `lakutata create --with <features>` enables (or which the user chooses in
a terminal):

- the template package's `package.json` declares them, with their names and descriptions:
  `"lakutata": {"template": "default", "features": {"i18n": "The messages in several languages"}}`;
- a feature's files are in `features/<name>/`, beside `template/` (and published with it, in the package's `files`).
  They are added to the project when the feature is enabled: a JSON file that the project already has is merged into it
  (its objects merged by key, such as the `package.json` scripts and the `tsconfig.json` options, and its arrays
  replaced), and any other file replaces the template's file;
- the template's files can contain blocks for a feature: the lines between `//@if <feature>` and `//@end` (or `//@else`;
  `//@if !<feature>` for when the feature is not enabled) are kept when the feature is enabled and removed otherwise,
  and the marker lines are always removed. The markers are written as comments in the file's language: `//@if i18n`,
  `#@if i18n`, `<!--@if i18n-->`, `/*@if i18n*/`.

### `lakutata info`

Show the versions of the tool and the framework (with their latest versions) and of Node.js, and the framework version
that the project in the current directory uses.

### `lakutata clean [paths...]`

Remove paths within the package in the current directory, on every platform (like `rm -rf`, without `shx` or `rimraf`):
`lakutata clean build dist`. Without paths, it removes its `tsconfig.json` output directories (`outDir`, and
`declarationDir` when there is one, following the configurations it extends): `"clean": "lakutata clean"`. A missing
path is skipped. Paths outside the package, the package itself, `src`, `node_modules`, `.git` and `package.json` are
never removed. In a workspace, `lakutata run clean` runs each package's `clean` script.

## Workspaces

Projects consisting of several packages (`app`, `ui`, `proxy`…) are npm workspaces. A directory's workspace is the
nearest one, from that directory upward, whose `package.json` has a `workspaces` field (a list of patterns, or
`{"packages": [...]}`), or whose `package.json` is next to a `pnpm-workspace.yaml` (its `packages:` list). The patterns
match directories (`*` within one name, `**` any number of directories, `!` excludes one), and those containing a
`package.json` with a name are the packages. The tool builds and versions their packages, covering the part of lerna
that these projects use, without lerna.

### `lakutata run <script>`

Run a script in every package that has it, in dependency order (in `dependencies`, `devDependencies`, `peerDependencies`
and `optionalDependencies`): a package starts once the packages it depends on, directly or indirectly, have finished,
and packages that do not depend on each other run at the same time. Scripts run with the project's package manager: the
`packageManager` field of the root `package.json`, otherwise the files at the root (`pnpm-lock.yaml` or
`pnpm-workspace.yaml` for pnpm, `yarn.lock`, `package-lock.json`); npm by default. Each output line starts with its
package's name. Scripts take no extra arguments. When no package has the script, the command reports this and succeeds.

| Option | |
|---|---|
| `--concurrency <n>` | how many packages run at a time, by default the number of processors |
| `--parallel` | run all packages at the same time, without waiting for their dependencies: for scripts that keep running (`lakutata run dev --parallel`) |
| `--no-bail` | continue after a failure: packages that do not depend on a failed one still run (by default, no package starts after the first failure, and those already running finish) |
| `--scope <names...>` | only the packages with these names (`*` is a wildcard); the packages they depend on are neither run nor waited for, and a scope matching no package is an error |

### `lakutata version <bump>`

Assign the next version to every package (`major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`,
or a version; `--preid <id>` names the prerelease of the `pre…` bumps), including private packages and those without a
version, and update the dependencies between them, in the packages and the root `package.json` (`^0.0.16` becomes
`^0.0.17`, as do `~`, `>=`, `=` and `workspace:^` ranges, while `*`, `workspace:*` and `file:` are kept). This matters
with `0.x` versions, because a range matches only its own version. The command also updates `package-lock.json` or
`pnpm-lock.yaml`, without which `npm ci` would fail. A `yarn.lock` is not updated (the command warns you to run
`yarn install`), and a failed update is only a warning. The workspace version is the `version` in `lerna.json` when that
file specifies one, otherwise that of the root `package.json`, otherwise the highest package version, prereleases
included (`0.0.0` when none has one), and the new version is written back there. `--git` commits the version's files,
and only them, with the message `v<version>`, and tags the commit `v<version>` (a lightweight tag, not pushed); the
repository and the tag are checked before any file is changed. The command asks for confirmation only in a terminal, and
`--yes` applies the version without asking.

### `lakutata add <name>`

Add a package to the workspace, in the workspace's packages directory (under its name without its scope): the directory
of the workspace's first pattern of the form `<directory>/*`, such as `apps/*`, or `packages/*` when there is one, so
that the other commands see the package; a workspace without such a pattern (its packages listed individually, or
`packages/**`) is refused. Its version is the workspace's (`lerna.json`, otherwise the root `package.json`, otherwise
the highest package version; `0.0.1` without one, or with lerna's independent versions). It is private (remove
`"private": true` to publish it), has `clean`, `build`, `rebuild` and `test` scripts and a test, and `--to <package>`
adds it to another workspace package's dependencies, as `^<version>`. The command installs nothing: afterwards, run the
install command of the project's package manager, as its output indicates, to link the package.

- `lakutata add greeting`: a TypeScript package (`src/index.ts` compiled into `build`, with its declarations).
- `lakutata add @acme/capture --native [gyp|cmake|rust]`: a native addon, with one of these build systems:
  - `gyp` (the default): C++ with [node-addon-api](https://github.com/nodejs/node-addon-api), built by node-gyp from
    `binding.gyp`;
  - `cmake`: C++ with node-addon-api, built by [cmake-js](https://github.com/cmake-js/cmake-js) from `CMakeLists.txt`;
  - `rust`: Rust with [napi-rs](https://napi.rs), built by cargo (`Cargo.toml`, `build.rs`, `rust/lib.rs`).

  Node-API is stable across Node.js and Electron versions, so the same addon runs in both without being rebuilt. The
  addon is built into `build/Release` (by `npm run build:native`, and by its `install` script when the package is
  installed) and loaded by node-gyp-build from `src/index.ts`, which is compiled into `dist`. C++ addons are built for
  Intel and Apple silicon Macs in a single file, a Rust addon for the machine's architecture. `lakutata native` links
  their libraries. The comments in `binding.gyp` and `CMakeLists.txt` also show how to specify libraries and build
  options: system libraries, pkg-config, the package's static libraries, dynamic libraries shipped with the addon
  (copied next to it and found there through its rpath), and in `binding.gyp` the C++ standard and per-platform options
  (`CMakeLists.txt` sets C++20). A library with its own Makefile is built before the addon by a script, as the package's
  README shows (`build:deps`). `lakutata package bundle` and `lakutata package exe` ship the addon, and its dynamic
  libraries, with the application. Building it requires a C++ toolchain (with CMake for `cmake`), or Rust for `rust`.

### `lakutata native <action> <value>`

Change the build of the native addon in the current directory, found by its build file (`binding.gyp`, `CMakeLists.txt`
or `Cargo.toml`). The file is edited in place, keeping its comments and layout; the addon's sources are not changed.
Repeating a change has no effect.

- `lakutata native link <library>`: link a library:
  - a system library: `lakutata native link pcap` (`ws2_32` with `--platform win`);
  - `--pkg-config`: a library found by pkg-config (`lakutata native link libpcap --pkg-config`; not on Windows);
  - `--framework`: a macOS framework (`lakutata native link CoreFoundation --framework`);
  - a package file: a static library (`deps/lib/libfoo.a`; `foo.lib` on Windows) is linked into the addon; a dynamic
    library (`deps/lib/libfoo.dylib`, `libfoo.so`, or `foo.dll` with its import library `foo.lib`) is copied next to the
    addon and found there at run time through its rpath (`@loader_path` on macOS, `$ORIGIN` on Linux). On macOS, its
    install name must be `@rpath/libfoo.dylib` (set with `install_name_tool -id`): the command reports this when it is
    not;
  - `--crate`: a crate, for a Rust addon (`cargo add`).
- `lakutata native include <directory>`: a header directory (C++), in the package or an absolute system directory.
- `lakutata native define <NAME[=value]>`: a preprocessor definition (C++).

`--platform mac|linux|win` applies the change to one platform only (a library file determines its own platform: `.dylib`
macOS, `.so` Linux, `.dll` and `.lib` Windows, `.a` every platform but Windows, like pkg-config). `--target <name>`
names the target to change when the build file has several. What is written, by build system:

| | gyp | CMake | Rust |
|---|---|---|---|
| File | `binding.gyp`, or the `.gypi` it includes that declares the target | `CMakeLists.txt` | `.cargo/config.toml` (`[env]`), read by `build.rs` |
| Library | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | the `-sys` crates |
| Framework | `xcode_settings.OTHER_LDFLAGS` | `-framework` in `if(APPLE)` | `rustc-link-lib=framework=` |
| Dynamic library | `copies`, the rpath | `INSTALL_RPATH` (`BUILD_WITH_INSTALL_RPATH`), a `POST_BUILD` copy | `rustc-cdylib-link-arg`, a copy in `build:native` |
| Headers, definitions | `include_dirs`, `defines` | `target_include_directories`, `target_compile_definitions` | none (crates) |
| Platform | `conditions` (`OS=="mac"`, `OS!="win"`) | `if(APPLE)`, `if(WIN32)`, `if(NOT WIN32)`, `if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`, `_LINUX`, `_WINDOWS`, `_UNIX` |

For a Rust addon, the libraries are passed to `build.rs` (written by `lakutata add --native rust`), which passes them to
cargo for the addon only: flags passed to rustc would apply to every crate it builds.

### `lakutata list`

List the packages: the first line shows their number and the workspace version, then each package has its version,
` (private)` when it is private, its directory and the workspace packages it depends on.

### From lerna

| lerna | `lakutata` |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git` (the tag is not pushed) |

Packages are still published with `npm publish -w <package>` (the packages that `lakutata add` creates are private:
remove `"private": true` first). From `lerna.json`, the tool reads and writes only `version`; the packages come from the
`workspaces` field of the root `package.json`, or from `pnpm-workspace.yaml`. It does not version packages independently
(a `lerna.json` with `"version": "independent"` cannot be bumped), write changelogs from commits or cache builds:
workspaces that need these features keep lerna (or nx, turborepo) alongside it.

## Native libraries

### `lakutata ffi generate <header>`

Generate the `@lakutata/ffi` class of a native library from its C header: its declarations, a property per function with
its TypeScript type, an interface per struct and union, its integer macros as constants. The header is run through the C
compiler's preprocessor (`cc -E`; `cl /P` on Windows, in the Visual Studio Developer Command Prompt); the library's
declarations are kept (those of the header, and of the headers in its directory unless it is a system directory), with
the system types they use. The functions are then checked against the library: those it does not export, or that cannot
be called (a `va_list` parameter), are left out. The command lists what it left out and why. The tool loads
`@lakutata/ffi` from the project, so install it there.

| Option | |
|---|---|
| `--library <name or file>` | the library the functions are checked against: a name, as `@Library` takes it, or a file; the header's name by default (`sqlite3.h` yields `sqlite3`; zlib requires `--library z`). When it cannot be loaded, the class is generated without the check, with a warning |
| `--class-name <name>` | the class name, by default the header name in PascalCase |
| `--out <file>` | the file written, `<class>.ts` in the current directory by default |
| `--force` | replace the file when it exists |
| `--include <directories...>` | the directories of the headers it includes (`-I`) |
| `--define <macros...>` | the macros defined before it: `NAME` or `NAME=value` (`-D`) |
| `--own <directories...>` | additional directories whose headers belong to the library |
| `--compiler <compiler>` | the C compiler whose preprocessor reads the header: `cc`, `gcc`, `clang`, `cl` (by default the one in `CC`, otherwise `cl` on Windows and `cc` elsewhere) |
| `--no-check` | do not check the functions against the library |

The class is generated for the platform the command runs on. A header does not indicate which pointers are output
parameters, nor which functions block: mark them in the generated file (`_Out_`, `{async: true}`). See the guide to
native libraries ([FFI](https://lakutata.com/guide/FFI), section 9).

## Bundles and executables

These commands pack the application in the current directory, which must be compiled first (by `tsc`, which emits
decorator metadata). The work is done by `@lakutata/builder`: the copy installed in the project
(`npm install --save-dev @lakutata/builder`, as the templates that pack their application do), otherwise the one
installed with the tool (a global install of the tool does not include it, because the builder is an optional peer
dependency). Scripts can also pack applications with its functions (`bundleProject`, `buildExecutable`).

### `lakutata package bundle`

Bundle the application and its dependencies into a single CommonJS file (with esbuild) that node runs without
`node_modules`: `dist/<name>.cjs`, where the name is the first `bin` in the `package.json`, otherwise the package name
without its scope. The entry is the `main` field of the `package.json`, otherwise `build/App.js` (`--entry` changes it).
The bundle is minified, keeping class names (`--no-minify` disables minification), and `import.meta.url` is the bundle's
URL.

| Option | |
|---|---|
| `--entry <file>` | the compiled entry, by default the `main` field of the `package.json`, otherwise `build/App.js` |
| `--outfile <file>` | the bundle, `dist/<name>.cjs` by default |
| `--no-minify` | do not minify the bundle |
| `--external <modules...>` | the modules left out of the bundle, loaded at run time from a `node_modules` next to it |

Bundles are CommonJS modules, because Node.js executables run them. The application's ES modules are converted, so they
cannot use top-level `await`: await inside an async function instead.

Native addons (`.node` files) cannot be bundled. While bundling, the tool finds packages that contain addons, and
packages that load them through computed paths (such as sharp). It leaves them out of the bundle, with what they load at
run time (the JavaScript they require, and the packages that provide the shared libraries linked with their addons, such
as libvips), and lays them out as in `node_modules` in `dist/<name>.native/`, which is distributed with the bundle. This
tree holds the files loaded at run time: all files of addon and shared library packages; for other packages, the
JavaScript they load (traced) and their other files (the data they read); and all files of packages that load their
files through paths that cannot be followed (`require(path.join(__dirname, name))`). The type declarations, source maps,
TypeScript sources and documentation of the packages are left out, as are the C and C++ sources of the addons and
objects (better-sqlite3 contains the SQLite source) and what built them: node-gyp and CMake files in `build/`, cargo's
`target` directory, static and import libraries. The application's own addons (`require('./x.node')`,
`createRequire(import.meta.url)('./x.node')`) also go into the tree. The framework's packages, and those built on it,
are always bundled with the application, whatever they depend on or contain, so that there is one copy of the framework,
its classes and its container. Their native dependencies go into the tree, as do their own addons when they are loaded
by a `require` of the file, by a path from their module (`path.join(__dirname, 'prebuilds', ...)`) or from their own
directory (`node-gyp-build`); an addon loaded in another way is named in the warnings. Optional dependencies that are
not installed (drivers for stores the application does not use: `peerDependenciesMeta` optional, `optionalDependencies`)
are left out; loading one throws at run time, as it would without the bundle.

The bundler does not follow files that the application reads by path: the scripts it runs separately (workers,
`new Worker()`, worker pools that receive a file; child processes, `fork()`; modules loaded by path,
`require(path.join(__dirname, 'x.js'))`) and its data (`fs.readFileSync(path.join(__dirname, 'defaults.json'))`, a
directory of schemas). In addition, the bundle is not where the modules were: in a module in `build/config/`,
`path.resolve(__dirname, '../../schema')` is the project's `schema/` directory, but no longer once bundled into `dist/`.
The tool finds every file path built from its module's location, wherever it is written, in the application's modules
and in those of its packages, and rewrites the expression to point to the file in the native tree
(`dist/<name>.native/.lakutata/files/`, with the directories laid out as in the project, and packages linked from
outside it under `node_modules/`):

| The path names | |
|---|---|
| a script (`.js`, `.cjs`) | bundled separately with what it loads (as a CommonJS file, whatever the project's module type) |
| another file | copied (a `package.json` has its type set to CommonJS, like the scripts next to it) |
| a data directory | its files copied |
| a directory holding the module (`path.join(__dirname, '..')`: the application, its packages) | not shipped, with a warning: declare its files as resources (`lakutata.resources`, below) |
| a directory holding scripts or packages (`package.json`, `node_modules`) | not shipped, with a warning: its scripts would need their packages at run time |
| nothing yet (a directory the application creates) | left unchanged |

The paths that are followed:

| Path | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | the module's URL (as in Vite); also `pathToFileURL(__filename)` |
| `import.meta.url + '/../worker.js'` | the module's URL as a string |
| `path.join(__dirname, 'worker.js')`, `path.resolve(__dirname, …)` | also with `import.meta.dirname` or `path.dirname(fileURLToPath(import.meta.url))` |
| `__dirname + '/worker.js'`, `` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')`, `require.resolve(path.resolve(__dirname, '../lib/worker'))` | the extension is found as node finds it |
| `` path.join(__dirname, 'locales', `${lang}.json`) ``, `` new URL(`./jobs/${name}.js`, import.meta.url) `` | partly known: every file and directory its pattern matches (an expression matches part of a name), with the expression kept |

Code emitted by tsc (`(0, node_path_1.join)(__dirname, 'worker.js')`) is also followed. A script that the application
also imports produces a warning: it is bundled twice, with a separate copy of its module (its state, its classes) in
each. Node.js workers (`worker_threads`) whose scripts cannot be followed produce a warning in the application's modules
(packages start workers from the paths their users provide): a path known only at run time (`new Worker(file)`; a
variable or a class property holding one of the paths above is followed), or a path relative to the process's current
directory (`new Worker('./worker.js')`, which node resolves from there, not from the module). Build the paths of their
scripts from the directory of their module, or ship the scripts as resources. Workers that run source code
(`eval: true`) need nothing. The warnings name only the application's modules, with their file and line.

The application's resources, the files it reads at run time (a web application's built pages, templates, data), are
declared in `lakutata.resources` in its `package.json`, as a list of `{from, to}` objects (like electron-builder's
`extraResources`, but without its strings, globs or filters):

```json
"lakutata": {"resources": [{"from": "../ui/dist", "to": "ui"}]}
```

`from` is a file or directory in the project, and `to` its path among the resources, in `dist/<name>.resources/`, which
is distributed with the bundle. The application finds them through `resourcesPath()` from `lakutata` (`undefined` when
it does not run packed, which `isPackaged()` indicates).

### `lakutata package exe`

Build an executable of the application for the platform it runs on, which runs without Node.js installed: `dist/<name>`
(`dist/<name>.exe` on Windows). The bundle is embedded, with its V8 code cache, in a copy of the Node.js binary running
the tool (a Node.js single executable application), so the embedded Node.js is the version running the tool. In an
executable, `import.meta.url` is the executable's own URL.

With `--runtime bun`, Bun compiles the bundle instead (`bun build --compile --bytecode`: the code is compiled to
bytecode, so it is not parsed at startup), using the project's Bun (the npm `bun` package,
`npm install --save-dev bun`), otherwise the system's. Its executables are smaller, start faster and use less memory;
the runtime is then Bun (JavaScriptCore, with its implementation of the Node.js APIs). The native addons are the Node.js
builds, not rebuilt for Bun. Bun loads Node-API addons, but may not load those built on the Node.js V8 API: the tool
warns about them (with better-sqlite3, the executable builds, and fails when it loads the package). Like Node.js
executables, Bun executables do not load the `.env` or `bunfig.toml` of the directory they run in (an application that
needs one loads it itself, or uses `LAKUTATA_ENV_FILE`), and the mode is that of the run: Bun would replace
`process.env.NODE_ENV` with its build's mode, but the bundle reads it at run time.

Build executables for other platforms on those platforms: the application's native addons are built there for them, and
the executables can be tested there. A CI provides the machines (a matrix of Linux, macOS and Windows runners); Linux
architectures can also be built in a container of that architecture (`docker run --platform linux/arm64`, as the
cross builds of the templates do).

| Option | |
|---|---|
| `--outdir <directory>` | the executable's directory, `dist` by default |
| `--runtime <node\|bun>` | the embedded runtime: `node` (the default) or `bun` |
| `--layout <file\|directory>` | a single file (the default), or a directory: `dist/<name>/` holds the executable, its native addons (`native/`) and its resources (`resources/`), loaded from there without extraction (for installers and images) |
| `--entry`, `--no-minify`, `--external` | as for `lakutata package bundle`: the external modules are loaded from a `node_modules` next to the executable |

With `--layout file`, the native addons, the files read by path and the resources are embedded in the executable. On its
first run, the executable extracts them into `native/<hash>`, a directory named after their content, in its cache
directory: `~/Library/Caches/<name>` on macOS, `%LOCALAPPDATA%\<name>\Cache` on Windows, `$XDG_CACHE_HOME/<name>` or
otherwise `~/.cache/<name>` on Linux, or the directory specified by `LAKUTATA_NATIVE_DIR`. When the cache directory is
not writable, it uses `<name>` in the temporary directory (not when `LAKUTATA_NATIVE_DIR` is set). Subsequent runs load
them from there, and different versions of the program do not share it. The addons need the system libraries they were
built for (the glibc version of the Linux prebuilt addons).

An executable's child processes run the executable itself (`process.execPath`). In both layouts, an executable started
for one of its scripts (`fork(path.join(__dirname, 'child.js'))`, `spawn(process.execPath, [script])`) runs that script
with its arguments, not the application: with Node.js, `require.main` is that script, as with node; with Bun, it is not.

macOS executables are signed ad hoc. Windows executables built with Node.js have no valid signature (the signature of
`node.exe` no longer matches, and setting an icon removes it): sign them before distributing them.

### `lakutata package installer`

Build the application's installers for the platform it runs on (as electron-builder does). They install its executable
in the directory layout (`lakutata package exe --layout directory`) with its native addons and resources, put its
program in the PATH and register its service. Build installers for other platforms on those platforms (Linux installers
can be built in a container). They are configured by `lakutata.installer` in the `package.json`:

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
| `name` | the package name (lower case), by default the program's name (for an Electron application, the package name without its scope) |
| `appId` | the application's identifier (reverse DNS, `com.acme.app`), by default its name: on macOS, the package identifier and the service label; on Windows, the key of its uninstaller and upgrades |
| `productName` | the name shown to users (in the installers, and in the Windows program list), by default the `productName` in the `package.json`, otherwise the name |
| `description`, `maintainer`, `homepage`, `license` | by default those of the `package.json` (the maintainer is its author) |
| `vendor` | its vendor, none by default (on Windows, the publisher is the vendor, otherwise the maintainer) |
| `runtime` | the executable's runtime: `node` (the default) or `bun`; `electron` for an Electron application, `nwjs` for an NW.js application (below) |
| `addToPath` | put the program in the PATH (`/usr/bin/<program>`, `/usr/local/bin/<program>` on macOS; on Windows, the machine's PATH), `true` by default (`false` for an NW.js application) |
| `service` | `true` or the service's options (below), none by default |
| `linux.targets` | `deb`, `rpm`, `archlinux`, `tar.gz` on glibc systems (`deb`, `rpm`, `tar.gz` by default); `apk`, `tar.gz` on Alpine (musl) |
| `linux.depends`, `linux.recommends`, `linux.section`, `linux.priority` | the system packages it needs and recommends, its section and its priority (deb) |
| `mac.targets` | `pkg`, `tar.gz` (both by default); `dmg` for an NW.js application |
| `win.targets` | `nsis`, `msi`, `zip` (all by default) |
| `electron` | an Electron application's electron-builder configuration, merged over the one generated from these options |

The configuration is checked before anything is built, including the options of installers that are not built.

Linux packages are built by nFPM (downloaded once into Lakutata's cache, for x64 and arm64; `LAKUTATA_NFPM` names
another copy, and one for other architectures) in `dist/installer` (`--outdir`). They install the application in
`/opt/<name>`, with the C++ runtime library as a dependency. The executables link the C library of the system they are
built on, so build packages for glibc systems on a glibc system, and `apk` packages on Alpine, with Bun
(`"runtime": "bun"`) when the application has native addons, because Node.js executables do not load them on musl.

macOS installers are built with macOS tools (`pkgbuild`, `productbuild`). The `pkg` package installs the application in
`/usr/local/lib/<name>` and its program in `/usr/local/bin`, only on Macs with the program's architecture. macOS does
not remove packages: `sudo /usr/local/lib/<name>/uninstall` removes the application (its data, environment file, user
and log are kept). The `pkg` package is not signed, and the executable it installs is only signed ad hoc (the Developer
ID signature and notarization, which distribution outside the organization's machines requires, are not performed yet).

Windows installers are built on Windows: the NSIS installer (`<name>-<version>-<arch>-setup.exe`) and the Windows
Installer package (`.msi`, built by WiX, for deployment in organizations) install the application in
`C:\Program Files\<name>` and its data in `C:\ProgramData\<name>`; they are removed like other Windows programs. Their
tools are downloaded once into Lakutata's cache (NSIS 3, WiX 3, WinSW; `LAKUTATA_NSIS`, `LAKUTATA_WIX` and
`LAKUTATA_WINSW` name other copies). Executables built with Node.js (`"runtime": "node"`) have no valid signature (the
Node.js signature no longer matches, and setting an icon removes it): sign them (signtool) before distributing them.

The service runs the application when the system starts: systemd (`/usr/lib/systemd/system/<service>.service`), OpenRC
on Alpine (`/etc/init.d/<service>`), launchd on macOS (`/Library/LaunchDaemons/<appId>.plist`), or WinSW on Windows
(`<name>-service.exe` next to the application, registered as a Windows service: `Restart-Service <service>`). The
installation starts it, an upgrade restarts it, and the removal stops and disables it first.

| Service option | |
|---|---|
| `name`, `description` | those of the package by default |
| `args` | the application's arguments |
| `env` | its environment (`MODE=production` by default), written to `/etc/<name>/<name>.env` (`/usr/local/etc/<name>/<name>.env` on macOS, `C:\ProgramData\<name>\<name>.env` on Windows), which administrators may edit (upgrades keep it) |
| `user` | its user: by default a system user named after the package (`_<name>` on macOS, hidden), created by the installation, or `root`; on Windows, by default its virtual account (`NT SERVICE\<service>`), or `LocalService`, `NetworkService` or `LocalSystem` |
| `restart` | `on-failure` (the default), `always` or `no` (on Windows and with OpenRC, `on-failure` and `always` behave alike) |
| `autoStart` | enabled and started by the installation, `true` by default; otherwise the administrator enables and starts it (`systemctl enable --now <service>`; on macOS, `launchctl enable system/<appId>`, then `launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`) |

Its working directory, which holds its data and is owned by its user, is `/var/lib/<name>` (`/usr/local/var/lib/<name>`
on macOS, with its log in `/usr/local/var/log/<name>.log`; `C:\ProgramData\<name>` on Windows, with its logs in `logs`).
`SIGTERM` ends it gracefully (on Windows, stopping the service sends a Ctrl+C, which Node.js receives as `SIGINT`).

Every bundle and executable, and therefore every installed application, loads the environment file named by the
`LAKUTATA_ENV_FILE` environment variable before the application launches (the Windows service receives its environment
this way, because its wrapper has no environment file): `NAME=value` or `NAME="value"` lines, and comments (`#`). The
file's values override variables that are already set.

The installers run the application's scripts (project files), as with electron-builder: a platform's scripts, which all
its installers run; an installer's scripts, each replacing the platform's script for the same moment; a Linux package's
native scripts; and an NSIS file included by the NSIS installer:

```json
"installer": {
  "linux": {
    "scripts": {"preinstall": "scripts/linux/preinstall.sh", "postinstall": "scripts/linux/postinstall.sh", "preremove": "scripts/linux/preremove.sh", "postremove": "scripts/linux/postremove.sh"},
    "rpm": {"scripts": {"postinstall": "scripts/linux/rpm-postinstall.sh"}},
    "deb": {"nativeScripts": {"postinstall": "scripts/linux/postinst.sh"}}
  },
  "mac": {"scripts": {"postinstall": "scripts/mac/postinstall.sh"}},
  "win": {"scripts": {"postinstall": "scripts/win/postinstall.ps1"}, "nsis": {"include": "scripts/win/installer.nsh"}}
}
```

| Script | |
|---|---|
| `preinstall` | before the application's files are installed (with Windows Installer, an upgrade has already removed the version it replaces) |
| `postinstall` | after they are installed, before the service starts (during an upgrade, the replaced version's service may still be running) |
| `preremove` | before the removal, once the service is stopped |
| `postremove` | after the files are removed |

Their first argument (`$1`, `$args[0]` in PowerShell) indicates what the installer is doing: `install` or `upgrade`
(`preinstall`, `postinstall`), or `remove` (`preremove`, `postremove`; an upgrade runs no removal script).
`LAKUTATA_INSTALL_DIR` provides the application's directory. They run as root (on Windows, as an administrator with NSIS
and as the system account with Windows Installer). When a script fails, the installation (or removal) fails. Each
package manager signals an upgrade in its own way (dpkg with `configure <version>`, rpm with the number of installed
versions, apk and pacman with their upgrade scripts): the installers translate them into these arguments.

- Linux (`linux.scripts`, `linux.<deb|rpm|apk|archlinux>.scripts`): scripts run by the interpreter named on their first
  line (`#!/bin/sh` by default), embedded in the packages' scripts. `linux.<package>.nativeScripts` are run the way the
  package manager runs package scripts, with its own arguments (`preinstall`, `postinstall`, `preremove`, `postremove`;
  `preupgrade`, `postupgrade` for apk and archlinux).
- macOS (`mac.scripts`, `mac.pkg.scripts`): sh scripts, as on Linux; the application's `uninstall` script runs the
  removal scripts (macOS does not remove packages).
- Windows (`win.scripts`, `win.<nsis|msi>.scripts`): PowerShell scripts (`.ps1`, run by Windows PowerShell; Windows
  Installer runs them through a command line, so each must fit in about 23 KB). `win.nsis.include` is an NSIS file
  (`.nsh`) included by the NSIS installer, which inserts its macros: `customHeader`, `customInit`, `customInstall` (at
  the end of installation), `customUnInit`, `customUnInstall` (at the start of removal).
- Archives (`tar.gz`, `zip`) run no scripts.

An Electron application's installers (`"runtime": "electron"`) are built by electron-builder, a project dependency. Its
main process is bundled with its dependencies (Electron excluded) into the application archive, and its native addons
and resources (`lakutata.resources`: its renderer and preload script, read from `resourcesPath()`) go next to it, in
Electron's resources. Its installers are electron-builder targets (by default `deb` on Linux, `dmg` on macOS and `nsis`
on Windows: `linux.targets`, `mac.targets`, `win.targets`). `name`, `appId`, `productName`, the description, maintainer,
homepage and license are passed to electron-builder, and `electron` provides the rest (icons, file associations,
signature, updates…); `addToPath` and the `linux` options other than `targets` and the scripts are not used, and
`vendor` is used on Linux only. Its native addons are copied as installed (electron-builder does not rebuild them):
Node-API addons run in Electron unchanged; install the Electron builds of the others before packing
(`electron-rebuild`). An Electron application is not a service. Its scripts are run by:

| Installer | Scripts |
|---|---|
| `deb`, `rpm` (packages built by fpm) | all (`postinstall` and `postremove` after electron-builder's scripts) |
| `pkg` (macOS) | `preinstall`, `postinstall` (a macOS application is removed by its user) |
| `nsis` (Windows) | `preinstall`, `postinstall`, `preremove` (its uninstaller ends by removing the files); the NSIS file of `win.nsis.include` defines the other macros |
| the others (`AppImage`, `dmg`, `portable`, `msi`…) | none |

On Linux arm64, fpm packages require the system's fpm (`gem install fpm`, `USE_SYSTEM_FPM=true`), because the one
electron-builder downloads is built for x64. On Windows arm64, NSIS installers compress the executables with the BCJ
filter (`ELECTRON_BUILDER_7Z_FILTER`), because they cannot extract files compressed with the ARM64 filter, which 7-Zip
would otherwise choose.

An NW.js application's installers (`"runtime": "nwjs"`) contain the normal flavor of its NW.js (`lakutata nwjs use`,
below), named after the application, with the application inside: its bundle for the Node.js of that NW.js, its native
addons made to load in it, its resources and the NW.js manifest. On Windows, the executable is `<name>.exe`, with the
application's icon and version information; on macOS, the bundle is `<productName>.app`, whose `Info.plist` specifies
its name, `appId`, version and icon (re-signed ad hoc). Its installers are desktop application installers, by default
`deb` on Linux, `dmg` on macOS and `nsis` on Windows: the Windows installers (`nsis`, `msi`) add it to the start menu
and the desktop, the `dmg` disk image holds it beside a link to /Applications and the `pkg` package installs it there,
and the Linux packages (`deb`, `rpm`) add its desktop entry and icons and depend on Chromium's libraries. `--arch`
builds them for an architecture other than the machine's (`ia32`: 32-bit Windows). An NW.js application is not a
service; its scripts run as for other applications (on macOS, it is removed by deleting it, without a removal script).

| Command option | |
|---|---|
| `--target <targets...>` | the installers to build, by default those in the configuration |
| `--outdir <directory>` | the installers' directory, `dist/installer` by default |
| `--entry`, `--no-minify`, `--external` | as for `lakutata package exe` |
| `--arch <arch>` | an NW.js application's architecture (`x64`, `ia32`, `arm64`), the machine's by default |

## NW.js

An NW.js application (the `nwjs-react` and `nwjs-vue` templates) runs in the NW.js version specified in its
`package.json`, `"lakutata": {"nwjs": {"version": "0.119.2"}}`. NW.js runtimes are downloaded once into Lakutata's cache
(from `https://dl.nwjs.io`, or the mirror specified by `LAKUTATA_NWJS_MIRROR`) and verified against their release's
checksums. Lakutata runs on releases whose Node.js is 18.10 or later.

### `lakutata nwjs versions`

List the NW.js releases that Lakutata runs on, newest first: their date, Node.js, Chromium and builds, with the latest
release and the last one that runs on Windows 7 (`win7`, 0.72.0) marked. It lists the ten latest and the Windows 7
release, or every release with `--all`. The release list (`https://nwjs.io/versions.json`, or the one specified by
`LAKUTATA_NWJS_VERSIONS`) is cached for a day.

### `lakutata nwjs use <version>`

Set the NW.js version of the application in the current directory: a version (`0.119.2`), `latest` or `win7`, written as
a version into `lakutata.nwjs` in its `package.json`. It also writes `nwjs.json`, the version with its Node.js and
Chromium, which the user interface build of the templates reads to target that Chromium, and reports the systems the
release runs on. `--download` immediately downloads its sdk flavor for the machine.

### `lakutata nwjs run [args...]`

Run the current directory's compiled application in NW.js: it is bundled into `.nwjs/app` for the Node.js of its NW.js,
with its resources and native addons made to load in it, then run with the arguments specified after `--`
(`lakutata nwjs run -- --ui=http://localhost:5173`). The command ends when NW.js exits, and stops NW.js when the command
is stopped.

| Option | |
|---|---|
| `--release <version>` | the NW.js release to run (a version, `latest`, `win7`), the one in `lakutata.nwjs` by default |
| `--flavor <sdk\|normal>` | `sdk` (the default: with the DevTools) or `normal` (the one the installers hold) |

## Mobile applications

A React Native mobile application laid out like the `mobile-react` template (Android, iOS, HarmonyOS) runs the
application in `packages/app` in a libnode, the Node.js library that its native module (`packages/ipc/native`) embeds;
its native projects are at the project root, its user interface in `packages/ui`. These commands, run in any directory
of the project, download that libnode, create the application's Node.js project, run the application, and deploy the
project during development.

### `lakutata mobile node <platform>`

Download a system's libnode (`android`, `ios` or `harmony`) from the
[lakutata/libnode](https://github.com/lakutata/libnode) releases and put it into
`packages/ipc/native/node/out/<platform>`, which the native projects build against; for HarmonyOS, `libnode.so` is also
put into the HAP's libraries (`harmony/entry/libs/arm64-v8a`). Its archives (`libnode_<platform>_<arch>.tar.gz`, one per
architecture) are verified with the release's `SHA256SUMS` and kept in Lakutata's cache (`~/.cache/lakutata/mobile`), so
they are downloaded only once. `lakutata mobile stage` downloads a system's libnode when the project does not have one
yet.

- `LAKUTATA_LIBNODE_MIRROR` specifies a mirror of the releases, with its files laid out as on GitHub
  (`<mirror>/v<version>/libnode_android_arm64.tar.gz`, `<mirror>/v<version>/SHA256SUMS`).
- `LAKUTATA_MOBILE_NODE_DIR` specifies your own libnode instead, built with the lakutata/libnode repository: a directory
  per system (`android`, `ios`, `harmony`), as its builds export them.

| Option | |
|---|---|
| `--abis <list>` | the Android architectures, separated by commas (`arm64-v8a,armeabi-v7a,x86_64`), `arm64-v8a,x86_64` by default |

### `lakutata mobile stage <platform>`

Create the application's Node.js project where the system's native project reads it:
`android/app/src/main/assets/nodejs` (copied into the application's files on its first launch), `ios/nodejs` (put into
the application bundle by its build) or `harmony/entry/src/main/resources/resfile/nodejs` (run from the HAP's
resources). The project holds the application's bundle for the libnode's Node.js version, its resources, its
`package.json` and its entry, which removes `fetch()` where WebAssembly is unavailable (HarmonyOS).

The native addons of the dependencies are built for the system from their package sources (`binding.gyp`), against the
libnode's headers and libraries. For Android, each libnode architecture has its own native tree, built by node-gyp with
the NDK (the latest in the Android SDK, or `ANDROID_NDK_HOME`); a package that ships prebuilt Android addons
(`prebuilds/android-<arch>`) keeps them. For iOS, on macOS, each addon becomes a framework for devices and one for
simulators, built with Xcode into `ios/NodeAddons`, which the application build embeds. An addon is built with the
settings its package specifies for macOS (`OS=="mac"` in its `binding.gyp` and in node-addon-api's gyp files), while the
SDK, architecture and deployment target are those of iOS. For HarmonyOS, each addon becomes a HAP library
(`libaddon-<package>-<file>.so` in `harmony/entry/libs/arm64-v8a`), built with the DevEco Studio native SDK (or
`OHOS_NDK_HOME`). The builds are kept in Lakutata's cache.

| Option | |
|---|---|
| `--abis <list>` | the Android architectures the addons are built for, the libnode's by default |
| `--no-minify` | keep the bundle readable |

### `lakutata mobile run <platform>`

Build the system's debug application and run it, with its user interface loaded from Metro (`npm start`). The installed
application's Node.js project replaces a previously deployed copy.

- Android: on the running emulator or device (or the one specified), built by Gradle for its architecture, installed,
  with Metro made reachable from it (`adb reverse`), and launched. adb is found in the Android SDK (`ANDROID_HOME`),
  otherwise in the `PATH`.
- iOS: on a simulator (the one specified, otherwise the running one, otherwise the newest iPhone, booted when needed),
  its pods installed first when the `Podfile` changed, built with `xcodebuild`, installed and launched with
  `xcrun simctl`, and shown in Simulator or in Device Hub.
- HarmonyOS: on the connected emulator or device (or the one specified), with its user interface bundled into the HAP
  (`react-native bundle-harmony`), the React Native libraries ported to HarmonyOS linked (`react-native link-harmony`,
  which adds their packages to `harmony/oh-package.json5`), its ohpm dependencies installed (`ohpm install --all`),
  built by DevEco Studio's hvigor (`DEVECO_STUDIO_HOME`, its SDK `DEVECO_SDK_HOME`), installed with hdc, Metro made
  reachable from it (`hdc rport`), and launched.

| Option | |
|---|---|
| `--device <id>` | the Android emulator or device (its serial, `adb devices`) or the HarmonyOS one (`hdc list targets`), the iOS simulator (its UDID or name, `xcrun simctl list devices`) |

### `lakutata mobile deploy <platform>`

Create the project, put it into the debug application installed on the device, and launch the application again: the
Node.js side changes without reinstalling the application. On Android, it writes into the application's files (`adb
shell run-as`), marked so that the application keeps it until it is reinstalled; on iOS, into the application in the
simulator, with the frameworks of the addons; on HarmonyOS, into the application's files (`hdc file send`), which the
native module runs instead of the project in the resources. The native addons are built for the device only (its Android
architecture, the iOS simulators); HarmonyOS addons are HAP libraries, which `lakutata mobile run harmony` installs.

| Option | |
|---|---|
| `--device <id>` | as for `lakutata mobile run` |
| `--watch` | watch the application's files (not its dependencies or compiled files): when they change, run its `build` script and deploy it again, until Ctrl+C |

## Migrations

### `lakutata migration <action>`

Manage the application's database migrations (its Database components and providers). `generate`, `run`, `revert` and
`show` run the package script that builds and launches the application (`dev` by default, run by the project's package
manager) with an environment variable (`MIGRATION_GENERATE`, `MIGRATION_RUN`, `MIGRATION_REVERT`, `MIGRATION_SHOW`). The
application then connects to its databases with their options, without synchronizing their schemas or running their
migrations, runs the command, reports what it did and exits, without starting its components or entrypoints. `create`
only writes a file.

| Action | |
|---|---|
| `generate` | migrations for entity changes: the application compares the entities with its databases and writes the migrations into the directory, one file `<timestamp>-<database name>.ts` per changed database (what `cross-env MIGRATION_GENERATE=./src/migrations npm run dev` did in Lakutata 2.x); when nothing changed, nothing is generated and the command ends normally (exit code 0) |
| `create <name>` | an empty migration to write manually (`up` and `down`): `<timestamp>-<name>.ts`, with the class `<Name><timestamp>` |
| `show` | the migrations in the databases' options, run (`[X]`) or pending (`[ ]`) |
| `run` | the pending migrations (`up`) |
| `revert` | the last migration run (`down`), one at a time; when the application has several databases, `--database` is required |

| Option | |
|---|---|
| `--dir <directory>` | the migrations directory, relative to the package, `src/migrations` by default (`generate`, `create`) |
| `--script <script>` | the script that builds and launches the application, `dev` by default |
| `--package <name>` | the application's package in the workspace, when the command runs from elsewhere in the workspace (by default, the package in the current directory) |
| `--database <name>` | the database: the name of its Database component or provider, all of them by default (`MIGRATION_DATABASE`) |
| `--transaction <mode>` | the transactions for the migrations run or reverted: `all` (one for all), `each` or `none`; by default the database's `migrationsTransactionMode`, otherwise `all` (`MIGRATION_TRANSACTION`) |
| `--fake` | mark the migrations as run or reverted without executing them (`MIGRATION_FAKE`) |

Migrations are compiled with the application and listed in their database's options (`migrations: [...]`; they run when
it connects with `migrationsRun: true`). The commands fail (exit code 1) when the application has no database (except
`generate`, which then generates nothing and exits with 0, as it does when the schema has no changes), when the
specified database is not one of the application's, and when a migration fails.

## Languages

### `lakutata i18n <action> [locale]`

Manage the application's messages for each language (`lakutata/com/i18n`), kept in a directory (`--dir`, `locales` by
default; several separated by commas) with one file (`zh-CN.json`) or one directory (`zh-CN/`) per language.

- `lakutata i18n check`: checks each language's messages against the default language's (`--default`, `en` by default),
  and fails on errors:
  - errors: an ICU MessageFormat syntax error, a key the default language does not have, an argument the default message
    does not have (missing when the message is formatted), a validation message with an unknown code or with another
    code's variables;
  - warnings: a missing message (a fallback language's message is used instead), an unused argument of the default
    message, a message identical to the default one (not translated yet). `--strict` also fails on warnings, for CI.
- `lakutata i18n types`: declares the default language's message keys and their arguments (`--out`, `src/i18n.d.ts` by
  default), so that a misspelled key or a missing argument is a compile error. `--module @lakutata/i18n` declares them
  for applications that import `@lakutata/i18n` rather than `lakutata/com/i18n`.
- `lakutata i18n add <locale>`: adds a language as a copy of the default language's messages, in a file or a directory
  like the default language's (without its validation messages, because the language has built-in ones). Translate them;
  `check` reports those not yet translated.

## The language of the tool

The tool's help (the descriptions of its commands and options), its prompts, option validation errors and a few results
(the `lakutata version` plan, a declined confirmation) are in English, Simplified Chinese (`zh-CN`) or Traditional
Chinese (`zh-TW`). The language comes from `LAKUTATA_LANG` (`LAKUTATA_LANG=zh-CN`), then from the environment
(`LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`), then from the system; English is used when none of them matches. The
command and option names, and the other results and errors, are in English.

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (by default `npm_config_registry`, otherwise `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a GitHub mirror for the `github:` templates (`https://github.com` by default) |
| `LAKUTATA_CACHE_DIR` | the cache directory (by default `$XDG_CACHE_HOME/lakutata`, otherwise `~/.cache/lakutata`) |
| `LAKUTATA_NWJS_MIRROR` | where NW.js runtimes are downloaded from (`https://dl.nwjs.io` by default) |
| `LAKUTATA_NWJS_VERSIONS` | the NW.js release list (`https://nwjs.io/versions.json` by default) |
| `LAKUTATA_LANG` | the tool's language (`zh-CN`, `zh-TW`, `en`), by default the environment's |

The tool is itself a Lakutata application: its commands are the CLI actions of its controllers, served by the
entrypoint's commander adapter.

## See also

- The guides on the website: [Command-Line Tool](https://lakutata.com/guide/Command) and
  [Workspaces](https://lakutata.com/guide/Workspaces).
