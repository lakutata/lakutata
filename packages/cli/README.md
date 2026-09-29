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

## Environment

| Variable | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | the npm registry of the templates (`npm_config_registry`, or `https://registry.npmjs.org`) |
| `LAKUTATA_GITHUB_DOWNLOAD` | a mirror of GitHub for the `github:` templates (`https://github.com`) |
| `LAKUTATA_CACHE_DIR` | the directory of the cache (`$XDG_CACHE_HOME/lakutata`, or `~/.cache/lakutata`) |

The tool is itself a lakutata application: its commands are the CLI actions of a controller, served by the commander
adapter of the entrypoint.
