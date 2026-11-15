# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) command line tool, whose commands are the actions of its controllers.
It is built into an executable that runs without Node.js. The project is a workspace: `packages/app` is the tool, and
the other packages are those it uses (`npx lakutata add <name>` adds a TypeScript package, or a native addon with
`--native`).

```bash
npm run build                                    # build the packages in the order of their dependencies
node packages/app/build/App.js greet --name you  # run a command of the built tool
npm test                                         # build the packages and run their tests
npm run package:exe                              # make the executable for this platform: dist/{$APP_ID} (.exe on Windows)
./dist/{$APP_ID} greet --name you                # run a command of the executable (--help lists the commands)
npm run package:bundle                           # make one JavaScript file with the dependencies: dist/{$APP_ID}.cjs
node dist/{$APP_ID}.cjs greet --name you         # run a command of the bundle
```

- `packages/app/src/App.ts` starts the tool.
- `packages/app/src/config/Config.ts` declares its components and the command line adapter: the command is `{$APP_ID}`,
  and its description and version come from `packages/app/package.json`.
- `packages/app/src/controllers/` holds the controllers. Each `@CLIAction` is a command whose options are the properties
  of its DTO (`packages/app/src/dtos/`), validated before the action runs. In a terminal, the tool asks for the required
  options that are missing.

`npm link -w app` installs the command `{$APP_ID}` on this machine. To publish it with `npm publish -w app`, first give
the package a name of its own and remove its `"private": true`.

## The executables and the bundle

`lakutata package bundle` bundles the compiled tool and its dependencies into `dist/{$APP_ID}.cjs`, which `node` runs
without `node_modules`. `lakutata package exe` embeds the bundle in the Node.js binary that runs the command (a single
executable application of Node.js): the executable runs on machines without Node.js, and the Node.js it embeds is the
version that made it.

- Native addons (`.node` files) are supported. The bundle has them next to it, in `dist/{$APP_ID}.native/`, which is
  distributed with it; the executable embeds them and extracts them on its first run into its cache directory, which
  `LAKUTATA_NATIVE_DIR` changes.
- The bundle is a CommonJS module, so the sources cannot use top-level `await` (use `await` inside an async function).
- The executables for macOS are signed ad hoc. The executables for Windows carry no valid signature: sign them before
  distributing them.

<!-- @if installer -->
## The installers

`npm run package:host` makes the installers for the platform it runs on, in `dist/installer`, with
`lakutata package installer` (configured by `lakutata.installer` in `packages/app/package.json`). The packages and
installers put the command `{$APP_ID}` in the PATH; the archives hold the tool as it is.

- Linux: deb and rpm packages, which install the tool in `/opt/{$APP_ID}`, and a tar.gz archive. `npm run package:linux`
  makes them in Docker (`Dockerfile.installer`) on any platform, and `npm run package:linux -- --platform linux/amd64`
  makes them for another architecture.
- macOS: a pkg package, which installs the tool in `/usr/local/lib/{$APP_ID}` (`sudo /usr/local/lib/{$APP_ID}/uninstall`
  removes it), and a tar.gz archive.
- Windows: an NSIS installer and a Windows Installer package (msi), which install the tool in
  `C:\Program Files\{$APP_ID}`, and a zip archive.

<!-- @end -->
## The other platforms

`npm run package:exe` makes the executable for the platform it runs on. The executables for the other platforms are made
on those platforms, where their native addons are built and where they can be tested. A CI service can make all of them,
for example GitHub Actions (`.github/workflows/build.yml`):

```yaml
name: build
on: push
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, ubuntu-24.04-arm, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run package:exe
      - uses: actions/upload-artifact@v4
        with:
          name: {$APP_ID}-${{ runner.os }}-${{ runner.arch }}
          path: dist/
```

On any machine with Docker, the Linux executables can also be made for another architecture, in a container of that
architecture. The project is copied into the container, so its own `node_modules` are not modified:

```bash
docker run --rm --platform linux/arm64 -v "$PWD":/source:ro -v "$PWD/dist":/source/dist node:22 sh -c \
  "cp -r /source /project && cd /project && rm -rf node_modules && npm ci && npm run package:exe && cp dist/{$APP_ID} /source/dist/{$APP_ID}-linux-arm64"
```
