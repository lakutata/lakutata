# Lakutata Command Line Tool

The **`lakutata` command** (package `@lakutata/cli`) creates projects from templates, runs scripts across the packages
of a workspace and gives them versions, adds packages and native addons, runs the migrations of an application, checks
its translations, and packs it into bundles, executables and installers. The README of `@lakutata/cli` lists every
option.

## 1. Installing and running it

```bash
npx @lakutata/cli create --name my-app     # without installing it
npm install --global @lakutata/cli         # or once for the machine, then: lakutata create --name my-app
```

The templates add `@lakutata/cli` to the `devDependencies` of the project, so its scripts call `lakutata` directly and
`npx lakutata` works inside it. The tool needs Node.js 18.10 or later (`>=18.10.0`).

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
| `--with` | | The optional features of the template, separated by commas (`i18n`, `installer`, `win7`) |
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
  the `outDir` and `declarationDir` of its `tsconfig.json`. It refuses paths outside the package, and `src`,
  `node_modules`, `package.json` and `.git`. The templates call it from their `build` or `rebuild` scripts.

## 3. Workspaces and native addons

`lakutata list`, `run`, `version` and `add` work on a workspace, a repository of several packages: they list its
packages, run a script in each of them in the order of their dependencies, give them one version, and add packages. See
[Workspaces](Workspaces.md).

`lakutata add <name> --native gyp|cmake|rust` adds a native addon written in C++ or Rust, and
`lakutata native <link|include|define> <value>` links libraries to it. See [NativeAddons](NativeAddons.md).

`lakutata ffi generate <header>` writes the class of a native library of `@lakutata/ffi` from its C header. See
[FFI](FFI.md), section 9.

## 4. Migrations and translations

`lakutata migration <action>` generates, creates, runs, reverts and shows the migrations of the databases of an
application. It builds and starts the application with its `dev` script, in a mode where only the databases are
connected. See [Migrations](Migrations.md), section 2.

`lakutata i18n <action>` checks the messages of the languages of an application, declares the types of their keys, and
adds a language. See [I18n](I18n.md#command-line-tools).

## 5. Packaging

`lakutata package bundle` and `package exe` pack a compiled application into one JavaScript file, or into an executable
that runs without Node.js: see [Packaging](Packaging.md). `lakutata package installer` makes its installers, which can
register it as a service: see [Installers](Installers.md).

An NW.js application gets its version of NW.js from `lakutata nwjs use <version>` (`latest`, `win7` or a version, which
`lakutata nwjs versions` lists), which writes it into its `package.json`. `lakutata nwjs run [args...]` runs the compiled
application in the sdk flavor of that NW.js (with the DevTools), its native addons made to load in it, and gives it the
arguments. Its installers hold the normal flavor ([Installers](Installers.md), section 9).

## 6. Environment variables

| Variable | Meaning |
|---|---|
| `LAKUTATA_LANG` | The language of the tool (`en`, `zh-CN`, `zh-TW`) |
| `LAKUTATA_NPM_REGISTRY` | The registry the templates come from (else `npm_config_registry`, else `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | Where the `github:` templates are downloaded from (`https://github.com` by default) |
| `LAKUTATA_CACHE_DIR` | The cache of the tool: the templates, the tools that make installers and the runtimes of NW.js (`$XDG_CACHE_HOME/lakutata`, else `~/.cache/lakutata`) |
| `LAKUTATA_NWJS_MIRROR` | Where the runtimes of NW.js are downloaded from (`https://dl.nwjs.io` by default) |
| `LAKUTATA_NWJS_VERSIONS` | The list of the releases of NW.js (`https://nwjs.io/versions.json` by default) |
| `NO_COLOR` | Turns the colors off |

The scripts and the applications the tool runs get the environment the tool was started with. The variables of the
packed applications are described in [Packaging](Packaging.md), section 6.
