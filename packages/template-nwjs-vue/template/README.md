# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) NW.js application. The project is a workspace:

- `packages/app`: the background script of NW.js, a lakutata application. Its controllers serve their `@ServiceAction`
  actions to the user interface (`nwjsServiceEntrypoint`); `MainWindow` is its window, whose host page
  (`packages/app/host`) holds the user interface in a webview;
- `packages/ui`: the user interface, Vue built by Vite. It runs in the webview, isolated from Node.js and from NW.js:
  `window.ipc` (`packages/ui/src/ipc.ts`, through the messages of the host page) invokes the actions of the
  application, `window.ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events it pushes,
  `window.ipc.on('greeted', listener)` (`once`, `off`);
- `packages/resources`: the resources of the application, its icon (`logo.png`: the icons of its installers and of its
  window).

```bash
npm run dev                 # the user interface served by Vite (hot reload) in the window of the application, with its DevTools
npm test                    # build the packages and run their tests (the actions of the application, without NW.js)
npm run build               # build the packages, in the order of their dependencies (ui, then app)
npm start                   # start the built application in NW.js
npm run package:host        # the installers of this platform: dist/installer (deb, dmg, nsis…)
npm run package:linux       # the ones of Linux, in Docker (Dockerfile.installer): dist/installer
# @if win7
npm run package:ia32        # the ones of 32-bit Windows (Windows 7), on Windows: dist/installer
# @end
npm run nwjs:use -- latest  # give the application another version of NW.js (latest, win7, 0.119.2…)
npm run version:patch       # give the packages their next version
```

A new action: a method of a controller of `packages/app/src/controllers` decorated by `@ServiceAction({cmd: 'name'}, DTO)`,
invoked by the user interface with `window.ipc.invoke({cmd: 'name', ...input})`: its input is validated by its DTO, its
result is given back, its errors are thrown in the user interface (with their `errno`). Each page is a client of the
application: its id is the `clientId` of the context of its requests, which the entrypoint pushes events to,
`this.entrypoint.notify(clientId, 'event', ...args)` (the id may be kept to push them later), or to every client,
`this.entrypoint.broadcast('event', ...args)`.

In development (under `lakutata nwjs run`), the actions are also served over HTTP on the port `DEV_PORT` (9000 by
default), for the tools such as Postman or curl: `POST /` with `{"cmd": "greet", "name": "you"}` answers the response of
the action; the id of the client in the `id` header. `GET /events?id=<client>` streams the events pushed to the client
(Server-Sent Events):

```bash
curl -N 'http://localhost:9000/events?id=me' &
curl -X POST http://localhost:9000/ -H 'id: me' -H 'Content-Type: application/json' -d '{"cmd": "greet", "name": "you"}'
```

## The version of NW.js

The application runs in the NW.js of the `lakutata.nwjs` of `packages/app/package.json`: in development, its sdk flavor
(`lakutata nwjs run`, with the DevTools), in its installers, its normal one. `npm run nwjs:use -- <version>` gives it
another version: `latest`, `win7` (0.72.0, the last one running on Windows 7, 8 and 8.1) or a version, which
`npx lakutata nwjs versions` lists. It writes `packages/app/nwjs.json` too, the Node.js and the Chromium of the version:
the application is bundled for that Node.js, the user interface built for that Chromium (`packages/ui/vite.config.ts`).
The runtimes of NW.js are downloaded once into the cache of lakutata (`~/.cache/lakutata`, or `LAKUTATA_CACHE_DIR`).
<!-- @if win7 -->

The application runs in NW.js 0.72.0 (Node.js 19.3, Chromium 109), the last release running on Windows 7, 8 and 8.1.
The 32-bit systems of Windows 7 need its installers of 32-bit Windows (`npm run package:ia32`, on Windows). Its native
addons are the ones of Node-API: the ones using the API of V8 run in NW.js 0.111.3 or later only.
<!-- @end -->

## The packaging

`npm run package:host` builds the packages and makes the installers of the platform it runs on with
`lakutata package installer` (configured by the `lakutata.installer` of `packages/app/package.json`): the runtime of
NW.js named after the application (its name, its icon and its version), with the background script bundled with its
dependencies, its native addons, the host page and the built user interface (its `lakutata.resources`). The installers
of Windows (`nsis`, `msi`) add the application to the start menu and to the desktop; the disk image of macOS (`dmg`)
holds it beside a link to /Applications to drag it to, and its `pkg` package installs it there; the packages of Linux
(`deb`, `rpm`) add it to the menus of the desktops; the archives (`zip`, `tar.gz`) hold it as it is. The installers are
made on their platform: `npm run package:linux` makes the ones of Linux in Docker on any platform
(`Dockerfile.installer`, whose system libraries are the ones the native addons need: add yours; `docker buildx build
--platform linux/amd64` makes the ones of another architecture), and `--arch ia32` the ones of 32-bit Windows.

```json
"installer": {
  "runtime": "nwjs",
  "linux": {"targets": ["deb"]},
  "mac": {"targets": ["dmg"]},
  "win": {"targets": ["nsis", "zip"]}
}
```

The native addons are made to load in NW.js when the application runs in it (packaged, or by `lakutata nwjs run`): the
ones built for another architecture than the one of the runtime, or using the API of V8, are built again from their
sources (with the headers of NW.js for the ones using V8); on Windows, they load the Node.js of NW.js. The ones of the
project are left as they are: its tests still run with Node.js.

The deb packages need the email of their maintainer: the `author` of `packages/app/package.json` is `"Name <email>"` (and
its `homepage` is the one of the packages). The application of macOS is signed ad hoc: the users of a downloaded one
allow it in the settings of the system, until it is signed with a Developer ID and notarized.
