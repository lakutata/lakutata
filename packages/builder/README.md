# @lakutata/builder

English | [中文](README.zh-CN.md)

The builder for lakutata applications. The `package bundle`, `package exe` and `package installer` commands of
`@lakutata/cli` use it, and a project's scripts can call it directly:

```js
import {buildExecutable, buildInstaller, buildNwjsApp, bundleProject} from '@lakutata/builder'

//dist/<name>.cjs, run by node, with its native addons and its resources next to it
await bundleProject({project: process.cwd()})
//An executable that runs without Node.js installed, with Node.js (the default) or Bun embedded. With layout
//'directory': dist/<name>/<name>, its native addons and resources next to it; with 'file' (the default): dist/<name>
await buildExecutable({project: process.cwd(), runtime: 'node', layout: 'directory'})
//dist/installer: the installers for the current platform (deb, rpm, apk, archlinux, tar.gz on Linux; pkg, tar.gz on
//macOS; nsis, msi, zip on Windows), which also register the application's service when it declares one
await buildInstaller({project: process.cwd()})
//An NW.js application (its version in lakutata.nwjs): dist/nwjs/<name>-<build>, the runtime of NW.js named after it
await buildNwjsApp({project: process.cwd()})
```

The builder works on the compiled application: build the project with `tsc` first, since `tsc` emits the decorator
metadata. The bundle is one CommonJS file, made by esbuild. Native addons cannot be bundled, so they are gathered, with
what they load at run time, into a native tree. The tree also holds the files that the application reads by path,
which the bundler does not follow: the scripts it runs on their own (workers, worker pools, `fork()`,
`require(path.join(__dirname, 'x.js'))`) are bundled, and its data files and directories are copied. The builder finds
the paths built from a module's location and rewrites them; whatever it cannot ship is listed in the `warnings` of the
result. At run time, `resourcesPath()` from lakutata locates the application's resources, declared by
`lakutata.resources` in its `package.json`. The installers are configured by `lakutata.installer` in the same file. See
`lakutata package bundle`, `lakutata package exe` and `lakutata package installer` in the `@lakutata/cli`
documentation.

The NW.js applications run in the version of NW.js of their `lakutata.nwjs`. `nwjsReleases()` lists the releases of
NW.js, `downloadNwjs()` downloads a runtime into the cache (checked against the checksums of its release), and
`stageNwjsApp()` makes the application for NW.js: its bundle for the Node.js of that NW.js, its native addons made to
load in it (built again for its architecture, or with its headers when they use the V8 API; on Windows, given the
Node.js of NW.js), its resources and the manifest of NW.js. `buildNwjsApp()` puts it into the normal flavor of NW.js
named after the application, and `buildInstaller()` makes its installers with `"runtime": "nwjs"` (the installers of a
desktop application: dmg on macOS, nsis on Windows, deb on Linux by default).

The Linux installers are tested in containers (Docker): `npm run test:installer` builds them on Debian and Alpine, then
installs, upgrades and removes them on Debian and Fedora (systemd) and on Alpine (OpenRC). The macOS installers are
installed in a macOS virtual machine (`npm run test:installer:mac`, with tart), and the Windows installers on Windows,
as an administrator (`LAKUTATA_WINDOWS_INSTALL=1 npm run test:installer:windows`).

## See also

- The guides on the website: [Packaging](https://lakutata.com/guide/Packaging) and
  [Installers](https://lakutata.com/guide/Installers).
