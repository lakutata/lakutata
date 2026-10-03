# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) command line tool: the actions of its controllers are its commands.
It is built into an executable which runs without Node.js. The project is a workspace: `packages/app` is the tool, the
other packages are the ones it uses (`npx lakutata add <name>`: a package of TypeScript, or a native addon with
`--native`).

```bash
npm run build                           # build the packages, in the order of their dependencies: node packages/app/build/App.js greet --name you
npm test                                # the tests of the packages
npm run package:exe                     # the executable of this platform: dist/{$APP_ID} (dist/{$APP_ID}.exe on Windows)
./dist/{$APP_ID} greet --name you       # run a command (--help lists them)
npm run package:bundle                  # one JavaScript file with the dependencies: node dist/{$APP_ID}.cjs greet --name you
```

- `packages/app/src/App.ts` starts the tool;
- `packages/app/src/config/Config.ts` declares its components and the command line adapter (its name, its description
  and its version come from `packages/app/package.json`);
- `packages/app/src/controllers/` holds the controllers: each `@CLIAction` is a command, whose options are the properties
  of its DTO (`packages/app/src/dtos/`), validated before the action runs. In a terminal, the missing required options
  are asked.

`npm link -w app` installs the command `{$APP_ID}` on this machine; `npm publish -w app` (named, without
`"private": true`) shares it.

## The executables and the bundle

`lakutata package bundle` bundles the compiled tool and its dependencies into `dist/{$APP_ID}.cjs`, run by node without
`node_modules`. `lakutata package exe` embeds the bundle into the Node.js binary running it (the single executable
applications of Node.js): the executable runs without Node.js installed, the Node.js embedded is the version which makes
it.

- The native addons (`.node` files) are handled: next to the bundle (`dist/{$APP_ID}.native/`, distributed with it),
  embedded in the executable, which extracts them at its first run into its cache directory (`LAKUTATA_NATIVE_DIR`
  changes it).
- The bundle is a CommonJS module: no top-level `await` in the sources (await in an async function).
- The executables of macOS are signed ad hoc. The executables of Windows keep the signature of Node.js, which does not
  match anymore: sign them before distributing them.

<!-- @if installer -->
## The installers

`npm run package:host` makes the installers of the platform it runs on (`lakutata package installer`, configured by the
`lakutata.installer` of `packages/app/package.json`) in `dist/installer`, the command `{$APP_ID}` in the PATH:

- Linux: the deb, rpm and tar.gz packages installing the tool in `/opt/{$APP_ID}`; `npm run package:linux` makes them in
  Docker (`Dockerfile.installer`) on any platform, `--platform linux/amd64` the ones of another architecture.
- macOS: the pkg package installing it in `/usr/local/lib/{$APP_ID}` (`sudo /usr/local/lib/{$APP_ID}/uninstall` removes it).
- Windows: the installer of NSIS and the package of Windows Installer (msi) installing it in `C:\Program Files\{$APP_ID}`.

<!-- @end -->
## The other platforms

`npm run package:exe` makes the executable of the platform it runs on: the executables of the other platforms are made on them
(their native addons are built there, and they are tried there). A CI makes them all, for example GitHub Actions
(`.github/workflows/build.yml`):

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

The Linux architectures are also made on any machine with Docker, in a container of the architecture (the project is
copied into it: the `node_modules` of the project are not changed):

```bash
docker run --rm --platform linux/arm64 -v "$PWD":/source:ro -v "$PWD/dist":/source/dist node:22 sh -c \
  "cp -r /source /project && cd /project && rm -rf node_modules && npm ci && npm run package:exe && cp dist/{$APP_ID} /source/dist/{$APP_ID}-linux-arm64"
```
