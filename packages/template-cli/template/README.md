# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) command line tool: the actions of its controllers are its commands.

```bash
npm run build                           # compile into build/
node build/App.js greet --name you      # run a command (node build/App.js --help lists them)
npm test                                # build and run the tests
npm run bundle                          # one file with the dependencies: node dist/{$APP_ID}.cjs greet --name you
npm run executable                      # an executable of this platform, without Node.js: dist/{$APP_ID}
npm run executable -- --target linux-x64 linux-arm64 darwin-arm64 darwin-x64 win-x64   # the other platforms
```

- `src/App.ts` starts the tool;
- `src/config/Config.ts` declares its components and the command line adapter (its name, its description and its version
  come from `package.json`);
- `src/controllers/` holds the controllers: each `@CLIAction` is a command, whose options are the properties of its DTO
  (`src/dtos/`), validated before the action runs. In a terminal, the missing required options are asked.

`npm link` installs the command `{$APP_ID}` on this machine; `npm publish` (without `"private": true`) shares it.

## The bundle and the executables

`lakutata bundle` bundles the compiled tool and its dependencies into `dist/{$APP_ID}.cjs`, run by node without
`node_modules`. `lakutata executable` embeds the bundle into the Node.js binary of each platform (the single executable
applications of Node.js), which runs without Node.js installed: the Node.js embedded is the version which runs the command.
The binaries of the other platforms are downloaded once from the Node.js distributions (`LAKUTATA_NODE_MIRROR`, or the
mirror of nvm `NVM_NODEJS_ORG_MIRROR`, e.g. `https://npmmirror.com/mirrors/node`) and checked.

- The native addons (`.node` files) are handled: next to the bundle (`dist/{$APP_ID}.native/`, distributed with it),
  embedded in the executable, which extracts them at its first run into its cache directory (`LAKUTATA_NATIVE_DIR`
  changes it). An executable with native addons is made for the platform making it: make the others on their platforms.
- The bundle is a CommonJS module: no top-level `await` in the sources (await in an async function).
- The executables of macOS are signed ad hoc when they are made on macOS; made elsewhere, sign them on macOS
  (`codesign --sign - <file>`). The executables of Windows keep the signature of Node.js, which does not match anymore:
  sign them before distributing them.
