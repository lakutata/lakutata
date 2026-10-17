# Lakutata Workspaces

A project made of several packages (an application, its web interface, shared libraries, native addons) is a
workspace: one repository whose root `package.json` lists the directories of its packages. The package manager (npm,
pnpm or yarn) links the packages to each other; the `lakutata` command runs their scripts in the order of their
dependencies, gives them one version, and adds new packages. It covers the part of lerna that these projects use.
Every template but `default` makes a workspace ([ProjectStructure](ProjectStructure.md), section 2).

## 1. A workspace

The root `package.json` of a project made by `lakutata create --name shop --template web-react` (its migration and
Docker scripts left out):

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

- **The packages** are the directories that the patterns of `workspaces` match and that hold a `package.json` with a
  `name`: `*` matches within one directory name, `**` any number of directories, and `!packages/old` leaves a directory
  out. `node_modules` and the directories starting with a dot are never searched. A pnpm workspace lists its patterns in
  `pnpm-workspace.yaml` instead, as a list under `packages:` (`- 'packages/*'` lines, or `['packages/*']`). - **The
  commands work from any directory** of the workspace: they use the nearest parent directory that declares a workspace.
  - **The dependencies between packages** are the ones in `dependencies`, `devDependencies`, `peerDependencies` or
  `optionalDependencies`, whatever their range (`^0.0.1`, `*`, `workspace:*`, `file:`). - **The build tools**
  (`@lakutata/cli`, `typescript`, `@types/node`) are development dependencies of the root, so every package can use them
  in its scripts.

`lakutata list` shows the packages, their versions, their directories and the packages each one depends on. Here,
`app` (the server) depends on `ui` (the web interface), whose built pages it serves:

```
2 packages, version 0.0.1
  app  0.0.1 (private)  packages/app  → ui
  ui   0.0.1 (private)  packages/ui
```

## 2. Running scripts

`lakutata run <script>` runs an npm script in every package that has it. A package starts once the packages it depends
on (directly or not) have finished, and packages that do not depend on each other run at the same time. Each line of
output starts with the name of its package:

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
| `--parallel` | Start all the packages at once, without waiting for their dependencies: for scripts that keep running, such as dev servers and watchers (`lakutata run dev --parallel`) |
| `--scope <names...>` | Only these packages; `*` matches any characters (`--scope 'app' '@shop/*'`). The packages they depend on are neither run nor waited for, and a scope matching no package is an error |
| `--concurrency <n>` | How many packages run at a time (the number of processors by default) |
| `--no-bail` | Go on after a failure: the packages that depend on the failed one are skipped, the others still run |

- **Failures**: by default, no package starts after a failure, and those already running finish. The command ends with
  `error: build failed in lib, not run in app` and the exit code 1.
- **No package has the script**: the command prints `No package has the script lint` and succeeds.
- **The package manager**: the scripts run with `npm run`, `pnpm run` or `yarn run`, chosen from the `packageManager`
  field of the root `package.json` (`"pnpm@9.15.0"`), else from the files at the root (`pnpm-lock.yaml` or
  `pnpm-workspace.yaml`, `yarn.lock`, `package-lock.json`); npm by default.
- **Arguments**: the scripts take no extra arguments (`lakutata run build -- --watch` is refused): add a script
  instead.

## 3. Giving the packages a version

All the packages of a workspace share one version. `lakutata version <bump>` gives it to all of them, and updates the
dependencies between them. From version 1.2.3:

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

- **The current version** is the `version` of `lerna.json` when that file gives one, else the one of the root
  `package.json`, else the highest version among the packages, a prerelease included (`0.0.0` when there is none). The
  new version is written back there, and into every package, the private ones included. - **The bumps** are `major`,
  `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, or an explicit version. `--preid <id>` names the
  prerelease of the `pre…` bumps (`beta` gives `1.3.0-beta.0`; without it, `1.3.0-0`). - **The dependencies between the
  packages** follow: `^0.0.16` becomes `^0.0.17`, and so do `~`, `>=`, `=` and `workspace:^` ranges. `*`, `workspace:*`
  and `file:` dependencies are left as they are. With `0.x` versions this matters, because `^0.0.16` does not accept
  `0.0.17`. - **The lock file** follows too: `package-lock.json` or `pnpm-lock.yaml` is updated, so that `npm ci` (or
  `pnpm install --frozen-lockfile`) still accepts it. A `yarn.lock` is not: the command reminds you to run
  `yarn install`. - **`--git`** commits the changed files, and only them, with the message `v1.3.0` and tags the commit
  `v1.3.0`. Nothing is pushed. The repository and the tag are checked before a file is changed. - **The confirmation**
  is asked only in a terminal: in CI, or when the output is piped, the version is given at once. `--yes` skips it in a
  terminal too.

## 4. Adding a package

`lakutata add <name>` creates a TypeScript package in the workspace; `--to <package>` adds it to the dependencies of
another package. In the `web-react` project of section 1, a package of code shared by the server and the web interface:

```bash
lakutata add @shop/shared --to app
```

```
✔ Package @shop/shared 0.0.1 added: packages/shared (package.json, tsconfig.json, src/index.ts, src/tests/index.spec.ts, README.md), a dependency of app
Next: npm install (links the package), then npm run rebuild -w @shop/shared
```

`--to` names one package: add the dependency to `ui` by hand, in `packages/ui/package.json`:

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

`npm run build` (`lakutata run rebuild`) now builds `@shop/shared` first, then `ui`, then `app`, and both import it as
any package: `import {greet} from '@shop/shared'`.

- **Where**: in the directory of the packages of the workspace, without the scope of the name: the directory of the
  first pattern such as `apps/*` (`packages/*` when there is one). A workspace whose patterns have no such directory
  (only packages named one by one, or `packages/**`) is refused. - **Its version** is the version of the workspace
  (`0.0.1` without one, or with the independent versions of lerna), and `--to` adds the dependency
  `"@shop/shared": "^0.0.1"`. - **Its files**: `src/index.ts` (an example function to replace), a test run by
  `node --test`, and a `package.json` whose scripts are `clean`, `build` (`tsc`), `rebuild` and `test`. It compiles
  `src` into `build`, with its type declarations, which its `exports` give to the other packages. Code that the web
  interface also uses must not use the modules of Node.js. - **Private**: the package is `"private": true`. Remove that
  line to publish it (`npm publish -w @shop/shared`). - **Nothing is installed**: run the install of the package manager
  of the workspace afterwards, as the command says (`pnpm install`, `yarn install`), so that the other packages see the
  new one.

`lakutata add <name> --native gyp|cmake|rust` creates a native addon instead: see [NativeAddons](NativeAddons.md).

## 5. Coming from lerna

| lerna | lakutata |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna run dev --parallel` | `lakutata run dev --parallel` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git` (the tag is not pushed) |

- A workspace can keep its `lerna.json`: lakutata reads and writes its `version` only. The packages come from the
  `workspaces` of the root `package.json` (or `pnpm-workspace.yaml`), not from the `packages` of `lerna.json`.
- lakutata gives all the packages one version: a `lerna.json` with `"version": "independent"` cannot be bumped.
- It does not write changelogs, cache builds, select the packages changed since a release, or publish: publish with
  `npm publish -w <package>`. Workspaces that need these keep lerna (or nx, turborepo) alongside it.
