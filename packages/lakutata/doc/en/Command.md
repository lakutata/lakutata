# Lakutata Command-Line Tool

The **`lakutata` command** (package `@lakutata/cli`) creates projects from templates, runs scripts across a workspace's
packages and assigns them versions, adds packages and native addons, runs an application's migrations, checks its
translations, and packs it into bundles, executables and installers. The `@lakutata/cli` README lists every option.

## 1. Installing and running it

```bash
npx @lakutata/cli create --name my-app     # without installing it
npm install --global @lakutata/cli         # or once for the machine, then: lakutata create --name my-app
```

The templates add `@lakutata/cli` to the project's `devDependencies`, so its scripts call `lakutata` directly and
`npx lakutata` works inside it. The tool requires Node.js 18.10 or later (`>=18.10.0`).

- `lakutata --help` lists the commands, `lakutata help <command>` (or `lakutata <command> --help`) describes one, and
  `lakutata --version` prints the tool's version. Without a command, the tool prints its help and exits with code 1.
- Options are written in kebab case (`--package-manager`). A boolean option that is on by default is turned off with
  `--no-` (`--no-git`, `--no-bail`).
- Results go to standard output, warnings (`! …`) to standard error. On failure, the tool prints `error: <message>` to
  standard error and exits with code 1. Colors are used only on a terminal, and `NO_COLOR` turns them off.
- **Language**: help, prompts and validation errors are in English, Simplified Chinese or Traditional Chinese, chosen
  from `LAKUTATA_LANG`, then `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`, then the system language
  (`LAKUTATA_LANG=zh-CN lakutata --help`). Command and option names, and the tool's other messages, remain in English.

## 2. Projects

### `lakutata create`

```bash
lakutata create --name my-app                                    # the default template, in ./my-app
lakutata create --name shop --template service --with i18n,installer --yes
lakutata create --name tool --template cli --package-manager none --no-git
```

| Option | Default | Meaning |
|---|---|---|
| `--name` | prompted for in a terminal | The application's name, which is also its directory's name |
| `--id` | the name in lower case | The application's ID and its package's name |
| `--bundle-id` | `com.example.<name>` | The application's ID on mobile systems (reverse domain name), for the mobile templates; the stores reject `com.example` |
| `--template` | `default` | An official template (`lakutata templates`), `npm:<package>[@<version>]`, `github:<owner>/<repo>[#<ref>]`, or a directory |
| `--path` | `.` | Where the project directory is created (`<path>/<name>`) |
| `--init` | | Create the project in `--path` itself, a directory that already exists |
| `--description`, `--author`, `--license` | license `UNLICENSED` | The package information |
| `--with` | | The template's optional features, separated by commas (`i18n`, `installer`, `win7`) |
| `--package-manager` | `npm`, or pnpm or yarn when one of them started the tool | `npm`, `pnpm`, `yarn`, or `none` to skip the installation |
| `--no-git` | | Do not create a git repository |
| `--yes` | | Do not prompt for the features or for a confirmation |

In a terminal, the tool prompts for a missing name, offers the template's features, shows what it is going to create and
asks for confirmation. It then copies the template, fills in the name, the ID and the other package information,
installs the dependencies (`<manager> install`) and runs `git init` (without a commit). An official template is the
newest release for the tool's major version, downloaded from the npm registry and kept in the tool's cache; without a
network connection, a previously downloaded template is used if one exists.

With `--init`, the directory's existing files are kept: a template file with the same name is not copied, and a warning
lists these files so that you can manually merge what you need (for `package.json`, its scripts and dependencies).

### `lakutata templates`, `info` and `clean`

- `lakutata templates` lists the official templates and their features. The list comes from the npm registry and is
  cached for a day (`--refresh` fetches it again). [Project Structure](ProjectStructure.md) describes what the templates
  contain.
- `lakutata info` shows the versions of the tool, the framework (with the latest ones when the registry is reachable)
  and Node.js, and the framework version that the project in the current directory uses.
- `lakutata clean [paths...]` removes paths in the current directory's package, on every platform; without paths, it
  removes the `outDir` and `declarationDir` of its `tsconfig.json`. It refuses paths outside the package, as well as
  `src`, `node_modules`, `package.json` and `.git`. The templates call it from their `build` or `rebuild` scripts.

## 3. Workspaces and native addons

`lakutata list`, `run`, `version` and `add` work on a workspace, a repository containing several packages: they list its
packages, run a script in each of them in dependency order, assign them one version, and add packages. See
[Workspaces](Workspaces.md).

`lakutata add <name> --native gyp|cmake|rust` adds a native addon written in C++ or Rust, and
`lakutata native <link|include|define> <value>` links libraries to it. See [Native Addons](NativeAddons.md).

`lakutata ffi generate <header>` writes the `@lakutata/ffi` class for a native library from its C header. See
[FFI](FFI.md), section 9.

## 4. Migrations and translations

`lakutata migration <action>` generates, creates, runs, reverts and shows the migrations of an application's databases.
It builds and launches the application with its `dev` script, in a mode where only the databases are connected. See
[Migrations](Migrations.md), section 2.

`lakutata i18n <action>` checks the messages of an application's languages, declares types for their keys, and adds a
language. See [Internationalization (i18n)](I18n.md#command-line-tools).

## 5. Packaging

`lakutata package bundle` and `package exe` pack a compiled application into a single JavaScript file, or into an
executable that runs without Node.js: see [Packaging](Packaging.md). `lakutata package installer` creates its
installers, which can register it as a service: see [Installers](Installers.md).

An NW.js application obtains its NW.js version from `lakutata nwjs use <version>` (`latest`, `win7` or any version that
`lakutata nwjs versions --all` lists), which writes it into its `package.json`. `lakutata nwjs run [args...]` runs the
compiled application in the sdk flavor of that NW.js version (with the DevTools), with its native addons prepared to
load in it, and passes it the arguments. Its installers contain the normal flavor ([Installers](Installers.md), section
9).

A React Native mobile application laid out like the `mobile-react` template runs in a libnode that its native module
embeds. `lakutata mobile node <android|ios|harmony>` downloads a system's libnode from the lakutata/libnode releases;
`lakutata mobile stage <platform>` creates the application's Node.js project where the system's native project picks it
up; `lakutata mobile run <platform>` builds the application and runs it on an emulator, a device or a simulator;
`lakutata mobile deploy <platform>` puts the Node.js project into the application installed there and relaunches the
application.

## 6. Environment variables

| Variable | Meaning |
|---|---|
| `LAKUTATA_LANG` | The tool's language (`en`, `zh-CN`, `zh-TW`) |
| `LAKUTATA_NPM_REGISTRY` | The registry the templates come from (otherwise `npm_config_registry`, otherwise `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | Where the `github:` templates are downloaded from (`https://github.com` by default) |
| `LAKUTATA_CACHE_DIR` | The tool's cache: templates, the tools that build installers, NW.js runtimes, and the libnode of the mobile applications with their native addons (`$XDG_CACHE_HOME/lakutata`, otherwise `~/.cache/lakutata`) |
| `LAKUTATA_NWJS_MIRROR` | Where NW.js runtimes are downloaded from (`https://dl.nwjs.io` by default) |
| `LAKUTATA_NWJS_VERSIONS` | The list of NW.js releases (`https://nwjs.io/versions.json` by default) |
| `LAKUTATA_LIBNODE_MIRROR` | A mirror of the lakutata/libnode releases, from which the libnode of the mobile applications is downloaded (`<mirror>/v<version>/libnode_<platform>_<arch>.tar.gz`) |
| `LAKUTATA_MOBILE_NODE_DIR` | A custom libnode for the mobile applications, built with the lakutata/libnode repository (one directory per system: `android`, `ios`, `harmony`), used instead of the releases |
| `NO_COLOR` | Turns colors off |

The scripts and applications that the tool runs receive the environment the tool was started with. The variables of
packed applications are described in [Packaging](Packaging.md), section 6.
