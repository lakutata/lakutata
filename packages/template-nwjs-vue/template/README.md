# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) NW.js application. The project is a workspace:

- `packages/app`: the NW.js background script, a lakutata application. Its controllers serve their `@ServiceAction`
  actions to the user interface (`nwjsServiceEntrypoint`), and `MainWindow` is its window, whose host page
  (`packages/app/host`) holds the user interface in a webview.
- `packages/ui`: the user interface, built with Vue and Vite. It runs in the webview, isolated from Node.js and from
  NW.js: `window.ipc` (`packages/ui/src/ipc.ts`, which communicates through messages with the host page) invokes the
  actions of the application, as in `window.ipc.invoke({cmd: 'greet', name: 'you'})`, and listens to the events the
  application pushes, as in `window.ipc.on('greeted', listener)` (with `once` and `off`).
- `packages/resources`: the resources of the application, such as its icon (`logo.png`, from which the icons of the
  installers and of the window are made).

```bash
npm run dev                 # open the window of the application, its user interface served by Vite (hot reload), with DevTools
npm test                    # build the packages and run their tests (the actions of the application, without NW.js)
npm run build               # build the packages in the order of their dependencies (ui, then app)
npm start                   # start the built application in NW.js
npm run package:host        # make the installers for this platform in dist/installer (deb, dmg, nsis…)
npm run package:linux       # make the installers for Linux in Docker (Dockerfile.installer), in dist/installer
# @if win7
npm run package:ia32        # make the installers for 32-bit Windows (Windows 7), on Windows, in dist/installer
# @end
npm run nwjs:use -- latest  # switch the application to another version of NW.js (latest, win7, 0.119.2…)
npm run version:patch       # give every package its next patch version
```

To add an action, write a method in a controller of `packages/app/src/controllers` and decorate it with
`@ServiceAction({cmd: 'name'}, DTO)`. The user interface invokes it with `window.ipc.invoke({cmd: 'name', ...input})`:
the input is validated by the DTO, the result is returned, and errors are thrown in the user interface with their
`errno`. Each page is a client of the application. Its id is the `clientId` of its request context, and the entrypoint
pushes events to it with `this.entrypoint.notify(clientId, 'event', ...args)` (the id can be kept to push events later),
or to every client with `this.entrypoint.broadcast('event', ...args)`.

In development (in the NW.js sdk flavor, which `lakutata nwjs run` uses), the actions are also served over HTTP on port
`DEV_PORT` (9000 by default), for tools such as Postman or curl. `POST /` with `{"cmd": "greet", "name": "you"}` returns
the response of the action; the request carries the client id in its `id` header. `GET /events?id=<client>` streams the
events pushed to that client (Server-Sent Events):

```bash
curl -N 'http://localhost:9000/events?id=me' &
curl -X POST http://localhost:9000/ -H 'id: me' -H 'Content-Type: application/json' -d '{"cmd": "greet", "name": "you"}'
```

## The version of NW.js

The application runs in the version of NW.js set by `lakutata.nwjs` in `packages/app/package.json`: in its sdk flavor
during development (`lakutata nwjs run`, with DevTools), and in its normal flavor in the installers.
`npm run nwjs:use -- <version>` switches it to another version: `latest`, `win7` (0.72.0, the last release that runs on
Windows 7, 8 and 8.1) or a version number (`npx lakutata nwjs versions` lists the latest ten releases and 0.72.0, and
`--all` lists all of them). `nwjs:use` also writes `packages/app/nwjs.json`, which records the Node.js and the Chromium
of the version: the application is bundled for that Node.js, and the user interface is built for that Chromium
(`packages/ui/vite.config.ts`). NW.js 0.72.0 has builds for x64 and ia32 only: macOS on Apple silicon uses its x64
build, there is none for Linux or Windows on arm64, and on an arm64 machine its installers for Linux are made with
`npm run package:linux -- --platform linux/amd64`. The runtimes of NW.js are downloaded once into the lakutata cache
(`~/.cache/lakutata`, or `LAKUTATA_CACHE_DIR`).
<!-- @if win7 -->

The application runs in NW.js 0.72.0 (Node.js 19.3, Chromium 109), the last release that runs on Windows 7, 8 and 8.1.
32-bit Windows 7 systems need the installers for 32-bit Windows (`npm run package:ia32`, on Windows). Its native addons
must use Node-API: addons that use the V8 API run only in NW.js 0.111.3 or later.
<!-- @end -->

## The packaging

`npm run package:host` builds the packages and makes the installers for the platform it runs on with
`lakutata package installer` (configured by `lakutata.installer` in `packages/app/package.json`). They contain the NW.js
runtime under the name, icon and version of the application, with the background script bundled with its dependencies,
its native addons, the host page and the built user interface (its `lakutata.resources`). The Windows installers
(`nsis`, `msi`) add the application to the Start menu and to the desktop; the macOS disk image (`dmg`) holds it beside a
link to /Applications to drag it to, and the `pkg` package installs it there; the Linux packages (`deb`, `rpm`) add it
to the desktop application menus; the archives (`zip`, `tar.gz`) hold it as it is. Installers are made on their own
platform. `npm run package:linux` makes the installers for Linux in Docker on any platform (`Dockerfile.installer`,
which installs the system libraries that the native addons need: add yours), and
`npm run package:linux -- --platform linux/amd64` makes them for another architecture; the option `--arch ia32` makes
those for 32-bit Windows.

```json
"installer": {
  "runtime": "nwjs",
  "linux": {"targets": ["deb"]},
  "mac": {"targets": ["dmg"]},
  "win": {"targets": ["nsis", "zip"]}
}
```

Native addons are adapted to load in NW.js whenever the application runs in it (packaged, or with `lakutata nwjs run`).
Addons built for another architecture than that of the runtime, or using the V8 API, are rebuilt from their sources
(with the NW.js headers for those using V8), and on Windows they load the Node.js built into NW.js. The addons of the
project itself are left unchanged, so its tests still run with Node.js.

The deb packages take their maintainer from the `author` of `packages/app/package.json`, written as `"Name <email>"`,
and their home page from its `homepage`. The macOS application is signed ad hoc: users who download it have to allow it
in the system settings, until it is signed with a Developer ID and notarized.
