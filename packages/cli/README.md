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
| `--template <name>` | the template, `default` by default (`lakutata templates` lists them) |
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

List the templates: the repositories `lakutata-template-<name>` of the `lakutata` organization. The list is kept for a
day (`--refresh` fetches it again); when it cannot be fetched, the list kept is used.

### `lakutata info`

Show the versions of the tool, of the framework (and their latest versions), of Node.js, and of the framework of the
project of the current directory.

## Environment

| Variable | |
|---|---|
| `GITHUB_TOKEN` | a token of the GitHub API, for its higher rate limit |
| `LAKUTATA_TEMPLATE_API` | a mirror of the GitHub API (`https://api.github.com`) |
| `LAKUTATA_TEMPLATE_DOWNLOAD` | a mirror of the archives of the repositories (`https://codeload.github.com`) |
| `LAKUTATA_TEMPLATE_OWNER` | the owner of the template repositories (`lakutata`) |
| `LAKUTATA_NPM_REGISTRY` | the npm registry (`npm_config_registry`, or `https://registry.npmjs.org`) |
| `LAKUTATA_CACHE_DIR` | the directory of the cache (`$XDG_CACHE_HOME/lakutata`, or `~/.cache/lakutata`) |

The tool is itself a lakutata application: its commands are the CLI actions of a controller, served by the commander
adapter of the entrypoint.
