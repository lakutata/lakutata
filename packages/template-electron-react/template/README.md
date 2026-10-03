# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) Electron application. The project is a workspace:

- `packages/app`: the main process, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  renderer over IPC (`ElectronIPCServiceEntrypoint`); `MainWindow` is its window;
- `packages/ui`: the renderer, React built by Vite. It is isolated from Node.js and from Electron: `window.ipc`
  (`packages/ui/src/ipc.ts`, through the preload script `packages/app/src/preload.cts`) invokes the actions of the main
  process, `window.ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events it pushes,
  `window.ipc.on('greeted', listener)` (`once`, `off`);
- `packages/resources`: the resources of the application, its icon (`logo.png`: the icons of its installers and of its
  window).

```bash
npm run dev            # the renderer served by Vite (hot reload) in the window of the application, with its DevTools
npm test               # the tests of the packages (the actions of the main process, without Electron)
npm run build          # build the packages, in the order of their dependencies (ui, then app)
npm start              # start the built application
npm run package:host      # the installers of this platform: dist/installer (deb, dmg, nsis…)
npm run package:linux # the ones of Linux, in Docker (Dockerfile.installer): dist/installer
npm run version:patch  # give the packages their next version
```

A new action: a method of a controller of `packages/app/src/controllers` decorated by `@ServiceAction({cmd: 'name'}, DTO)`,
invoked by the renderer with `window.ipc.invoke({cmd: 'name', ...input})`: its input is validated by its DTO, its result is
given back, its errors are thrown in the renderer (with their `errno`). The main process pushes events to the renderer of
a request, `NotifyRenderer(this.context, 'event', ...args)`, or to every window, `BroadcastToRenderers('event', ...args)`
(`lakutata/adapter/electron`).

## The packaging

`npm run package:host` builds the packages and makes the installers of the platform it runs on with `lakutata package installer`
(electron-builder, configured by the `lakutata.installer` of `packages/app/package.json`): the main process bundled with
its dependencies in the archive of the application, its native addons, the preload script and the built renderer (its
`lakutata.resources`) next to it, in the resources of Electron. The installers of Windows are made on Windows, the ones of
macOS on macOS, the ones of Linux on Linux: `npm run package:linux` makes them in Docker on any platform
(`Dockerfile.installer`, whose system libraries are the ones the native addons need: add yours; `docker buildx build
--platform linux/amd64` makes the ones of another architecture).

```json
"installer": {
  "runtime": "electron",
  "linux": {"targets": ["deb"], "scripts": {"postinstall": "build/linux/postinstall.sh"}},
  "mac": {"targets": ["dmg"]},
  "win": {"targets": ["nsis", "portable"], "scripts": {"postinstall": "build/win/postinstall.ps1"}},
  "electron": {"linux": {"category": "Utility"}}
}
```

`electron` is the configuration of electron-builder (its icons, its file associations, its signature, its updates…),
merged over the one made from `lakutata.installer`. The scripts of the installers (`scripts`, run by the deb and rpm
packages, the pkg package of macOS and the installer of NSIS) are the ones of `lakutata package installer` (its documentation in
`@lakutata/cli`).

The deb packages need the email of their maintainer: the `author` of `packages/app/package.json` is `"Name <email>"` (and
its `homepage` is the one of the packages).

The native addons built for Node.js (not with N-API) are rebuilt for Electron before packaging: `npx @electron/rebuild`
(and `npm rebuild` to run the tests with Node.js again).

Electron downloads its binary the first time it runs (`npx install-electron` downloads it ahead, for a CI caching it).
