# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) command line tool: the actions of its controllers are its commands.
It is built into an executable which runs without Node.js.

```bash
npm run build                           # the executable of this platform: dist/{$APP_ID} (dist/{$APP_ID}.exe on Windows)
./dist/{$APP_ID} greet --name you       # run a command (--help lists them)
npm test                                # compile and run the tests
npm run compile                         # compile into build/, run by node: node build/App.js greet --name you
npm run bundle                          # one JavaScript file with the dependencies: node dist/{$APP_ID}.cjs greet --name you
```

- `src/App.ts` starts the tool;
- `src/config/Config.ts` declares its components and the command line adapter (its name, its description and its version
  come from `package.json`);
- `src/controllers/` holds the controllers: each `@CLIAction` is a command, whose options are the properties of its DTO
  (`src/dtos/`), validated before the action runs. In a terminal, the missing required options are asked.

`npm link` installs the command `{$APP_ID}` on this machine; `npm publish` (without `"private": true`) shares it.

## The executables and the bundle

`lakutata bundle` bundles the compiled tool and its dependencies into `dist/{$APP_ID}.cjs`, run by node without
`node_modules`. `lakutata executable` embeds the bundle into the Node.js binary running it (the single executable
applications of Node.js): the executable runs without Node.js installed, the Node.js embedded is the version which makes
it.

- The native addons (`.node` files) are handled: next to the bundle (`dist/{$APP_ID}.native/`, distributed with it),
  embedded in the executable, which extracts them at its first run into its cache directory (`LAKUTATA_NATIVE_DIR`
  changes it).
- The bundle is a CommonJS module: no top-level `await` in the sources (await in an async function).
- The executables of macOS are signed ad hoc. The executables of Windows keep the signature of Node.js, which does not
  match anymore: sign them before distributing them.

## The other platforms

`npm run build` makes the executable of the platform it runs on: the executables of the other platforms are made on them
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
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: {$APP_ID}-${{ runner.os }}-${{ runner.arch }}
          path: dist/
```

The Linux architectures are also made on any machine with Docker, in a container of the architecture (the project is
copied into it: the `node_modules` of the project are not changed):

```bash
docker run --rm --platform linux/arm64 -v "$PWD":/source:ro -v "$PWD/dist":/source/dist node:22 sh -c \
  "cp -r /source /project && cd /project && rm -rf node_modules && npm ci && npm run build && cp dist/{$APP_ID} /source/dist/{$APP_ID}-linux-arm64"
```
