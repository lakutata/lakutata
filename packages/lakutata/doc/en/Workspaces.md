# Lakutata Workspaces

A project made of several packages (an application, its web interface, shared libraries, native addons) is a workspace:
one repository whose root `package.json` lists its packages' directories. The package manager (npm, pnpm or yarn) links
the packages to each other; the `lakutata` command runs their scripts in dependency order, assigns them one version, and
adds new packages. It covers the part of lerna that these projects use. Every template except `default` creates a
workspace ([Project Structure](ProjectStructure.md), section 2).

## 1. A workspace

The root `package.json` of a project created by `lakutata create --name shop --template web-react` (with its migration
and Docker scripts omitted):

```json
{
  "name": "shop-workspace",
  "version": "0.0.1",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "lakutata run rebuild",
    "test": "npm run build && lakutata run test",
    "dev": "lakutata run dev --parallel",
    "start": "npm start -w app",
    "version:patch": "lakutata version patch --yes"
  },
  "devDependencies": {
    "@lakutata/cli": "^3.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^6.0.3"
  }
}
```

- **The packages** are the directories that match the `workspaces` patterns and hold a `package.json` with a `name`: `*`
  matches within one directory name, `**` any number of directories, and `!packages/old` excludes a directory.
  `node_modules` and directories starting with a dot are never searched. A pnpm workspace lists its patterns in
  `pnpm-workspace.yaml` instead, as a list under `packages:` (`- 'packages/*'` lines, or `['packages/*']`).
- **The commands work from any directory** in the workspace: they use the nearest parent directory that declares a
  workspace.
- **The dependencies between packages** are those in `dependencies`, `devDependencies`, `peerDependencies` or
  `optionalDependencies`, whatever their range (`^0.0.1`, `*`, `workspace:*`, `file:`).
- **The build tools** (`@lakutata/cli`, `typescript`, `@types/node`) are the root's development dependencies, so every
  package can use them in its scripts.

`lakutata list` shows the packages, their versions, their directories and the packages each one depends on. Here,
`app` (the server) depends on `ui` (the web interface), whose built pages it serves:

```
2 packages, version 0.0.1
  app  0.0.1 (private)  packages/app  → ui
  ui   0.0.1 (private)  packages/ui
```

## 2. Running scripts

`lakutata run <script>` runs an npm script in every package that has it. A package starts once the packages it depends
on (directly or indirectly) have finished, and packages that do not depend on each other run at the same time. Each
output line starts with its package's name:

```
lib   │ start lib
tools │ start tools
tools │ end tools
lib   │ end lib
app   │ start app
app   │ end app
✔ build ran in tools, lib, app
```

| Option | Meaning |
|---|---|
| `--parallel` | Start all packages at the same time, without waiting for their dependencies: for scripts that keep running, such as dev servers and watchers (`lakutata run dev --parallel`) |
| `--scope <names...>` | Only these packages; `*` matches any characters (`--scope 'app' '@shop/*'`). The packages they depend on are neither run nor waited for, and a scope matching no package is an error |
| `--concurrency <n>` | How many packages run at a time (the number of processors by default) |
| `--no-bail` | Continue after a failure: packages that depend on the failed one are skipped, and the others still run |

- **Failures**: by default, no package starts after a failure, and those already running finish. The command ends with
  `error: build failed in lib, not run in app` and exit code 1.
- **No package has the script**: the command prints `No package has the script lint` and succeeds.
- **The package manager**: scripts run with `npm run`, `pnpm run` or `yarn run`, chosen from the `packageManager` field
  in the root `package.json` (`"pnpm@9.15.0"`), otherwise from the files at the root (`pnpm-lock.yaml` or
  `pnpm-workspace.yaml`, `yarn.lock`, `package-lock.json`); npm by default.
- **Arguments**: scripts take no extra arguments (`lakutata run build -- --watch` is rejected); add a script instead.

## 3. Giving the packages a version

All packages in a workspace share one version. `lakutata version <bump>` assigns it to all of them, and updates the
dependencies between them. Starting from version 1.2.3:

```bash
lakutata version patch                     # 1.2.4, after a confirmation in a terminal
lakutata version minor --git --yes         # 1.3.0, committed and tagged v1.3.0
lakutata version preminor --preid beta     # 1.3.0-beta.0, then prerelease gives 1.3.0-beta.1
lakutata version 2.0.0
```

The output, in a workspace at 0.0.16:

```
Version 0.0.16 → 0.0.17
  app    0.0.16 → 0.0.17
  lib    0.0.16 → 0.0.17
  tools  0.0.16 → 0.0.17
✔ Version 0.0.17 given (packages/app/package.json, packages/lib/package.json, packages/tools/package.json, package.json)
```

- **The current version** is the `version` in `lerna.json` when that file specifies one, otherwise the one in the root
  `package.json`, otherwise the highest version among the packages, including prereleases (`0.0.0` when there is none).
  The new version is written back there, and into every package, including private ones.
- **The bumps** are `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, or an explicit version.
  `--preid <id>` names the prerelease for `pre…` bumps (`beta` yields `1.3.0-beta.0`; without it, `1.3.0-0`).
- **The dependencies between packages** follow: `^0.0.16` becomes `^0.0.17`, and so do `~`, `>=`, `=` and `workspace:^`
  ranges. `*`, `workspace:*` and `file:` dependencies are left unchanged. This matters with `0.x` versions, because
  `^0.0.16` does not accept `0.0.17`.
- **The lock file** also follows: `package-lock.json` or `pnpm-lock.yaml` is updated, so that `npm ci` (or
  `pnpm install --frozen-lockfile`) still accepts it. A `yarn.lock` is not updated: the command reminds you to run
  `yarn install`.
- **`--git`** commits the changed files, and only those, with the message `v1.3.0`, and tags the commit `v1.3.0`.
  Nothing is pushed. The repository and the tag are checked before any file is changed.
- **The confirmation** is requested only in a terminal: in CI, or when the output is piped, the version is assigned
  immediately. `--yes` also skips it in a terminal.

## 4. Adding a package

`lakutata add <name>` creates a TypeScript package in the workspace; `--to <package>` adds it to another package's
dependencies. In the `web-react` project from section 1, a package for code shared by the server and the web interface:

```bash
lakutata add @shop/shared --to app
```

```
✔ Package @shop/shared 0.0.1 added: packages/shared (package.json, tsconfig.json, src/index.ts, src/tests/index.spec.ts, README.md), a dependency of app
Next: npm install (links the package), then npm run rebuild -w @shop/shared
```

`--to` names only one package, so add the dependency to `ui` manually, in `packages/ui/package.json`:

```json
{
  "dependencies": {
    "@shop/shared": "^0.0.1"
  }
}
```

Then `npm install` links the new package, and `lakutata list` shows it:

```
3 packages, version 0.0.1
  app           0.0.1 (private)  packages/app  → ui, @shop/shared
  @shop/shared  0.0.1 (private)  packages/shared
  ui            0.0.1 (private)  packages/ui  → @shop/shared
```

`npm run build` (`lakutata run rebuild`) now builds `@shop/shared` first, then `ui`, then `app`, and both import it like
any other package: `import {greet} from '@shop/shared'`.

- **Where**: in the workspace's packages directory, under the name without its scope. The packages directory is the
  directory of the first pattern such as `apps/*` (`packages/*` when there is one). A workspace whose patterns have no
  such directory (only individually named packages, or `packages/**`) is rejected.
- **Its version** is the workspace's version (`0.0.1` without one, or with lerna's independent versions), and `--to`
  adds the dependency `"@shop/shared": "^0.0.1"`.
- **Its files**: `src/index.ts` (an example function to replace), a test run by `node --test`, and a `package.json`
  whose scripts are `clean`, `build` (`tsc`), `rebuild` and `test`. It compiles `src` into `build`, with its type
  declarations, which its `exports` expose to the other packages. Code that the web interface also uses must not use
  Node.js modules.
- **Private**: the package is `"private": true`. Remove that line to publish it (`npm publish -w @shop/shared`).
- **Nothing is installed**: run the install command of the workspace's package manager afterwards, as the command
  indicates (`pnpm install`, `yarn install`), so that the other packages see the new one.

`lakutata add <name> --native gyp|cmake|rust` creates a native addon instead: see [Native Addons](NativeAddons.md).

## 5. Coming from lerna

| lerna | `lakutata` |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna run dev --parallel` | `lakutata run dev --parallel` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git` (the tag is not pushed) |

- A workspace can keep its `lerna.json`: `lakutata` reads and writes only its `version`. The packages come from the
  `workspaces` field of the root `package.json` (or from `pnpm-workspace.yaml`), not from the `packages` field of
  `lerna.json`.
- `lakutata` assigns one version to all packages: a `lerna.json` with `"version": "independent"` cannot be bumped.
- It does not write changelogs, cache builds, select packages changed since a release, or publish: publish with
  `npm publish -w <package>`. Workspaces that need these features keep lerna (or nx, turborepo) alongside it.
