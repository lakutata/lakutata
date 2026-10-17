# Lakutata Command Line Tool

The **`lakutata` command** (package `@lakutata/cli`) creates projects from templates, runs scripts across the packages
of a workspace and gives them versions, runs the migrations of an application, checks its translations, and packs it
into bundles, executables and installers. The README of `@lakutata/cli` lists every option.

## 1. Installing and running it

```bash
npx @lakutata/cli create --name my-app     # without installing it
npm install --global @lakutata/cli         # or once for the machine, then: lakutata create --name my-app
```

The templates add `@lakutata/cli` to the `devDependencies` of the project, so its scripts call `lakutata` directly and
`npx lakutata` works inside it. The tool needs Node.js `^22.13.0 || >=24.11.0`: 22.13 or a later 22.x, or 24.11 and
later (not 23).

- `lakutata --help` lists the commands, `lakutata help <command>` (or `lakutata <command> --help`) describes one, and
  `lakutata --version` prints the version of the tool. Without a command, the tool prints its help and exits with code
  1.
- Options are written in kebab case (`--package-manager`). A boolean option that is on by default is turned off with
  `--no-` (`--no-git`, `--no-bail`).
- Results go to standard output, warnings (`! …`) to standard error. A failure prints `error: <message>` on standard
  error and exits with code 1. Colors are used on a terminal only, and `NO_COLOR` turns them off.
- **Language**: the help, the prompts and the validation errors are in English, Simplified Chinese or Traditional
  Chinese, chosen from `LAKUTATA_LANG`, then `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`, then the language of the
  system (`LAKUTATA_LANG=zh-CN lakutata --help`). The names of commands and options, and the other messages of the
  tool, stay in English.

## 2. Projects

### `lakutata create`

```bash
lakutata create --name my-app                                    # the default template, in ./my-app
lakutata create --name shop --template service --with i18n,installer --yes
lakutata create --name tool --template cli --package-manager none --no-git
```

| Option | Default | Meaning |
|---|---|---|
| `--name` | asked in a terminal | The name of the application, and of its directory |
| `--id` | the name in lower case | The ID of the application and the name of its package |
| `--template` | `default` | An official template (`lakutata templates`), `npm:<package>[@<version>]`, `github:<owner>/<repo>[#<ref>]`, or a directory |
| `--path` | `.` | Where the project directory is created (`<path>/<name>`) |
| `--init` | | Create the project in `--path` itself, a directory that already exists |
| `--description`, `--author`, `--license` | license `UNLICENSED` | The information of the package |
| `--with` | | The optional features of the template, separated by commas (`i18n`, `installer`) |
| `--package-manager` | `npm`, or pnpm or yarn when one of them started the tool | `npm`, `pnpm`, `yarn`, or `none` to skip the installation |
| `--no-git` | | Do not create a git repository |
| `--yes` | | Do not ask for the features or for a confirmation |

In a terminal, the tool asks for a missing name, offers the features of the template, shows what it is going to create
and asks for a confirmation. It then copies the template, fills in the name, the ID and the other information of the
package, installs the dependencies (`<manager> install`) and runs `git init` (without a commit). An official template
is the newest release for the major version of the tool, downloaded from the npm registry and kept in the cache of the
tool; without a network, a template downloaded earlier is used when there is one.

With `--init`, the files the directory already has are kept: a file of the template with the same name is not copied,
and a warning lists these files so that you can merge what you need by hand (for `package.json`, its scripts and
dependencies).

### `lakutata templates`, `info` and `clean`

- `lakutata templates` lists the official templates and their features. The list comes from the npm registry and is
  kept for a day (`--refresh` fetches it again). [ProjectStructure](ProjectStructure.md) describes what the templates
  contain.
- `lakutata info` shows the versions of the tool, of the framework (with the latest ones when the registry can be
  reached) and of Node.js, and the version of the framework that the project of the current directory uses.
- `lakutata clean [paths...]` removes paths of the package in the current directory, on every platform; without paths,
  the `outDir` of its `tsconfig.json`. It refuses paths outside the package, and `src`, `node_modules`, `package.json`
  and `.git`. The templates call it from their `build` or `rebuild` scripts.

## 3. Workspaces

A workspace is a repository holding several packages: the `workspaces` field of its root `package.json` (or a
`pnpm-workspace.yaml`) lists their directories. Every template but `default` makes a workspace (`packages/app`, plus
`packages/ui` for a web interface). These commands work from any directory of the workspace.

`lakutata list` shows the packages, their versions and directories, and the packages of the workspace each one depends
on.

### `lakutata run`

`lakutata run <script>` runs an npm script in every package that has it, in the order of their dependencies: a package
starts once the packages it depends on have finished, and packages that do not depend on each other run at the same
time. Each line of output starts with the name of its package.

| Option | Meaning |
|---|---|
| `--scope <names...>` | Only these packages (`*` matches any characters); the packages they depend on are not added |
| `--parallel` | All the packages at once, without waiting for their dependencies: for scripts that keep running, such as dev servers and watchers |
| `--concurrency <n>` | How many packages run at a time (the number of processors by default) |
| `--no-bail` | Go on after a failure (the packages that depend on the failed one are skipped) |

The scripts run with the package manager of the project (the `packageManager` field of its root `package.json`, else its
lock file: pnpm, yarn or npm) and take no extra arguments. The command fails (exit code 1) when a script fails, and
succeeds with a note when no package has the script.

### `lakutata version`

`lakutata version <bump>` gives every package of the workspace its next version, and updates the dependencies between
them:

```bash
lakutata version patch                     # 1.2.3 → 1.2.4, after a confirmation in a terminal
lakutata version minor --git --yes         # also commits the change and tags it v1.3.0
lakutata version prerelease --preid beta   # 1.3.0 → 1.3.1-beta.0, then 1.3.1-beta.1
lakutata version 2.0.0
```

All the packages share one version: the `version` of `lerna.json` when that file exists, else the one of the root
`package.json`, else the highest version of the packages. The command writes the new version back there and into every
package, keeps ranges such as `workspace:*` and the operators of the others, and updates `package-lock.json` or
`pnpm-lock.yaml` (run `yarn install` for a `yarn.lock`). It pushes nothing. A workspace managed by lerna keeps its
`lerna.json`: lakutata reads and writes its `version` only.

### `lakutata add` and `native`

`lakutata add <name>` creates a TypeScript package (`--native gyp|cmake|rust` for a native addon) in the directory of
the packages of the workspace (`packages/<name>`, or `apps/<name>` when its pattern is `apps/*`), with the version of
the workspace; `--to <package>` adds it to the dependencies of another package. The command installs nothing: run the
install of your package manager afterwards, as its output says. `lakutata native <link|include|define> <value>` changes
the build file of the native addon in the current directory (it links a library, adds a directory of headers, or defines
a macro); its help describes the options.

## 4. Migrations and translations

`lakutata migration <action>` generates, creates, runs, reverts and shows the migrations of the databases of an
application. It builds and starts the application with its `dev` script, in a mode where only the databases are
connected. See [Migrations](Migrations.md), section 2.

`lakutata i18n <action>` checks the messages of the languages of an application, declares the types of their keys, and
adds a language. See [I18n](I18n.md#command-line-tools).

## 5. Packaging

`lakutata package bundle`, `package exe` and `package installer` pack a compiled application into one JavaScript file,
into an executable that runs without Node.js, or into installers. See [Packaging](Packaging.md).

## 6. Environment variables

| Variable | Meaning |
|---|---|
| `LAKUTATA_LANG` | The language of the tool (`en`, `zh-CN`, `zh-TW`) |
| `LAKUTATA_NPM_REGISTRY` | The registry the templates come from (else `npm_config_registry`, else `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | Where the `github:` templates are downloaded from (`https://github.com` by default) |
| `LAKUTATA_CACHE_DIR` | The cache of the tool: the templates, and the tools that make installers (`$XDG_CACHE_HOME/lakutata`, else `~/.cache/lakutata`) |
| `NO_COLOR` | Turns the colors off |

The scripts and the applications the tool runs get the environment the tool was started with. The variables of the
packed applications are described in [Packaging](Packaging.md).
