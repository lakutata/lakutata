# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) Electron application. The project is a workspace:

- `packages/app`: the main process, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  renderer over IPC (`ElectronIPCServiceEntrypoint`); `MainWindow` is its window;
- `packages/ui`: the renderer, Vue built by Vite. It is isolated from Node.js and from Electron: it invokes the actions
  of the main process through the preload script (`packages/app/src/preload.cts`), `Invoke('greet', {name: 'you'})`
  (`packages/ui/src/lakutata.ts`).

```bash
npm run dev            # the renderer served by Vite (hot reload) in the window of the application, with its DevTools
npm test               # the tests of the packages (the actions of the main process, without Electron)
npm run build          # build the packages, in the order of their dependencies (ui, then app)
npm start              # start the built application
npm run package        # the installers of this platform: release/dist (deb, dmg, nsis…: electron-builder.json)
npm run cross          # the deb of linux/arm64, in a container of the architecture: release/cross (Docker)
npm run version:patch  # give the packages their next version
```

A new action: a method of a controller of `packages/app/src/controllers` decorated by `@ServiceAction({cmd: 'name'}, DTO)`,
invoked by the renderer with `Invoke('name', input)`: its input is validated by its DTO, its result is given back, its
errors are thrown in the renderer.

## The packaging

`npm run package` builds the packages, assembles the application in `release/app` (`scripts/assemble.mjs`: the main
process bundled with its dependencies by `lakutata bundle`, the preload script, the built renderer) and packages it with
electron-builder for the platform it runs on (`electron-builder.json`): the installers of Windows are made on Windows, the
ones of macOS on macOS. The native addons of the main process are next to the archive of the application
(`Resources/main.native`), unpacked.

The deb packages need the email of their maintainer: the `author` of `package.json` is `"Name <email>"` (and its
`homepage` is the one of the packages).

The native addons built for Node.js (not with N-API) are rebuilt for Electron before packaging: `npx @electron/rebuild`
(and `npm rebuild` to run the tests with Node.js again).

`npm run cross -- linux/arm64 linux/amd64` packages the application for Linux in a container of each architecture
(`scripts/cross.mjs`, emulated by QEMU when it is not the one of the machine): the project is installed and packaged in the
image of the `Dockerfile`, whose system libraries are the ones the native addons need (add yours).

Electron downloads its binary the first time it runs (`npx install-electron` downloads it ahead, for a CI caching it).
