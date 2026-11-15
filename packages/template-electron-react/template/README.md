# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) Electron application. The project is a workspace:

- `packages/app`: the main process, a lakutata application. Its controllers serve their `@ServiceAction` actions to the
  renderer over IPC (`electronIPCServiceEntrypoint`), and `MainWindow` is its window.
- `packages/ui`: the renderer, built with React and Vite. It is isolated from Node.js and from Electron: `window.ipc`
  (`packages/ui/src/ipc.ts`, provided by the preload script `packages/app/src/preload.cts`) invokes the actions of the
  main process, as in `window.ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events the main process
  pushes, as in `window.ipc.on('greeted', listener)` (with `once` and `off`).
- `packages/resources`: the resources of the application, such as its icon (`logo.png`, from which the icons of the
  installers and of the window are made).

```bash
npm run dev            # open the window of the application, its renderer served by Vite (hot reload), with DevTools
npm test               # build the packages and run their tests (the actions of the main process, without Electron)
npm run build          # build the packages in the order of their dependencies (ui, then app)
npm start              # start the built application
npm run package:host   # make the installers for this platform in dist/installer (deb, dmg, nsis…)
npm run package:linux  # make the installers for Linux in Docker (Dockerfile.installer), in dist/installer
npm run version:patch  # give every package its next patch version
```

To add an action, write a method in a controller of `packages/app/src/controllers` and decorate it with
`@ServiceAction({cmd: 'name'}, DTO)`. The renderer invokes it with `window.ipc.invoke({cmd: 'name', ...input})`: the
input is validated by the DTO, the result is returned, and errors are thrown in the renderer with their `errno`. Each
page is a client of the main process. Its id is the `clientId` of its request context, and the entrypoint pushes events
to it with `this.entrypoint.notify(clientId, 'event', ...args)` (the id can be kept to push events later), or to every
client with `this.entrypoint.broadcast('event', ...args)`.

In development (when the application is not packaged), the actions are also served over HTTP on port `DEV_PORT` (9000 by
default), for tools such as Postman or curl. `POST /` with `{"cmd": "greet", "name": "you"}` returns the response of the
action; the request carries the client id in its `id` header. `GET /events?id=<client>` streams the events pushed to
that client (Server-Sent Events):

```bash
curl -N 'http://localhost:9000/events?id=me' &
curl -X POST http://localhost:9000/ -H 'id: me' -H 'Content-Type: application/json' -d '{"cmd": "greet", "name": "you"}'
```

## The packaging

`npm run package:host` builds the packages and makes the installers for the platform it runs on with
`lakutata package installer` (electron-builder, configured by `lakutata.installer` in `packages/app/package.json`). The
main process is bundled with its dependencies into the archive of the application; its native addons, the preload script
and the built renderer (its `lakutata.resources`) are placed next to it, in the Electron resources. The installers for
Windows are made on Windows, those for macOS on macOS and those for Linux on Linux. `npm run package:linux` makes the
installers for Linux in Docker on any platform (`Dockerfile.installer`, which installs the system libraries that the
native addons need: add yours), and `npm run package:linux -- --platform linux/amd64` makes them for another
architecture.

```json
"installer": {
  "runtime": "electron",
  "linux": {"targets": ["deb"], "scripts": {"postinstall": "scripts/linux/postinstall.sh"}},
  "mac": {"targets": ["dmg"]},
  "win": {"targets": ["nsis", "portable"], "scripts": {"postinstall": "scripts/win/postinstall.ps1"}},
  "electron": {"linux": {"category": "Utility"}}
}
```

`electron` holds the electron-builder configuration (icons, file associations, signing, updates…), merged over the
configuration made from `lakutata.installer`. The installer scripts (`scripts`) are those of
`lakutata package installer`; its documentation in `@lakutata/cli` describes which installers run which scripts (the
disk images for macOS and the portable executables for Windows run none).

The deb packages take their maintainer from the `author` of `packages/app/package.json`, written as `"Name <email>"`
(without an email, `<name>@localhost` is used and a warning is shown), and their home page from its `homepage`.

Native addons built for Node.js rather than with N-API are rebuilt for Electron before packaging, with
`npx @electron/rebuild`; `npm rebuild` rebuilds them for Node.js to run the tests again.

Electron downloads its binary the first time it runs; `npx install-electron` downloads it in advance, for example for a
CI cache.
