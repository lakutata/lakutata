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
| `--package-manager <npm\|pnpm\|yarn\|none>` | the package manager installing the dependencies, the one running the tool by default |
| `--no-git` | do not initialize a git repository |
| `--yes` | create the project without confirmation |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
```

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
- `lakutata add @acme/capture --native`: a native addon. Its C++ (`cpp/binding.cc`) uses
  [node-addon-api](https://github.com/nodejs/node-addon-api): Node-API is stable across the versions of Node.js and
  Electron, so the same addon runs in both without being rebuilt. `binding.gyp` builds it with the C++ exceptions
  (thrown in JavaScript as errors) on every platform, for the Macs with Intel and with Apple silicon in one file;
  node-gyp builds it into `build/Release` (`npm run build:native`, and when the package is installed), node-gyp-build
  loads it from `src/index.ts`, compiled into `dist`. `lakutata bundle` and `lakutata executable` ship it with the
  application. Building it needs Python and a C++ toolchain (the Xcode command line tools on macOS, build-essential on
  Linux, the Visual Studio Build Tools on Windows).

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

The application of the current directory, compiled (`tsc`, which emits the metadata of the decorators), is packed:

### `lakutata bundle`

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
addons, such as libvips), laid out as in `node_modules`: `dist/<name>.native/`, distributed with the bundle. The addons of
the application itself (`require('./x.node')`, `createRequire(import.meta.url)('./x.node')`) are there too.

### `lakutata executable`

Make the executable of the application for the platform it runs on, which runs without Node.js installed: the bundle
embedded in the Node.js binary running the tool (the single executable applications of Node.js), `dist/<name>`
(`dist/<name>.exe` on Windows). The Node.js embedded is the version running the tool.

The executables of the other platforms are made on them, as the applications are built there: their native addons are
built for them, and they are tried there. The CI gives the machines of the platforms (a matrix of the Linux, macOS and
Windows runners); the Linux architectures are also made in a container of the architecture (`docker run --platform
linux/arm64`, as the cross builds of the templates).

| Option | |
|---|---|
| `--outdir <directory>` | the directory of the executable, `dist` by default |
| `--entry`, `--no-minify`, `--external` | as `lakutata bundle` |

The native addons are embedded in the executable: at its first run, it extracts them into its cache directory
(`~/.cache/<name>`, `~/Library/Caches/<name>` on macOS, `%LOCALAPPDATA%\<name>\Cache` on Windows, or `LAKUTATA_NATIVE_DIR`;
the temporary directory when it cannot be written), in a directory named after their content: the next runs load them
from there, the versions of the program do not share it. The addons need the system libraries they were built for (the
glibc version of the Linux prebuilt addons).

The executables of macOS are signed ad hoc. The ones of Windows keep the signature of `node.exe`, which does not match
anymore: sign them before distributing them.

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

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (`npm_config_registry`, or `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a mirror of GitHub for the `github:` templates (`https://github.com`) |
| `LAKUTATA_CACHE_DIR` | the directory of the cache (`$XDG_CACHE_HOME/lakutata`, or `~/.cache/lakutata`) |

The tool is itself a lakutata application: its commands are the CLI actions of a controller, served by the commander
adapter of the entrypoint.
