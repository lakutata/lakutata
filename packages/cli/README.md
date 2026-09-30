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

Make the executables of the application, which run without Node.js installed: the bundle embedded in the Node.js binary
of each platform (the single executable applications of Node.js). The Node.js embedded is the version running the tool.
The executable of the current platform is `dist/<name>`; `--target` makes the ones of other platforms,
`dist/<name>-<target>`, from the binaries of the Node.js distributions, downloaded once (and checked against their
`SHASUMS256.txt`).

```bash
lakutata executable --target linux-x64 linux-arm64 darwin-arm64 darwin-x64 win-x64
```

| Option | |
|---|---|
| `--target <targets...>` | the platforms, as the Node.js distributions name them (`linux-x64`, `win-x64`…) or as Docker does (`linux/amd64`, `windows/amd64`…), the current one by default |
| `--outdir <directory>` | the directory of the executables, `dist` by default |
| `--entry`, `--no-minify`, `--external` | as `lakutata bundle` |

The native addons are embedded in the executables: at its first run, an executable extracts them into its cache directory
(`~/.cache/<name>`, `~/Library/Caches/<name>` on macOS, `%LOCALAPPDATA%\<name>\Cache` on Windows, or `LAKUTATA_NATIVE_DIR`;
the temporary directory when it cannot be written), in a directory named after their content: the next runs load them
from there, the versions of the program do not share it. The addons being the ones of the platform making the
executable, the executables with native addons are made for this platform only: make the others on their platforms (a
machine or a runner of the CI of the platform; for Linux, a container of the architecture: `docker run --platform linux/arm64`).
The addons need the system libraries they were built for (the glibc version of the Linux prebuilt addons).

The executables of macOS are signed ad hoc when they are made on macOS (on another system, sign them on macOS:
`codesign --sign - <file>`). The ones of Windows keep the signature of `node.exe`, which does not match anymore: sign them
before distributing them.

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (`npm_config_registry`, or `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a mirror of GitHub for the `github:` templates (`https://github.com`) |
| `LAKUTATA_NODE_MIRROR` | the mirror of the Node.js distributions of the executables (`NVM_NODEJS_ORG_MIRROR`, or `https://nodejs.org/dist`) |
| `LAKUTATA_CACHE_DIR` | the directory of the cache (`$XDG_CACHE_HOME/lakutata`, or `~/.cache/lakutata`) |

The tool is itself a lakutata application: its commands are the CLI actions of a controller, served by the commander
adapter of the entrypoint.
