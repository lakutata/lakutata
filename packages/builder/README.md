# @lakutata/builder

English | [中文](README.zh-CN.md)

The builder for Lakutata applications. The `package bundle`, `package exe` and `package installer` commands of
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

The builder works on the compiled application: build the project with `tsc` first, since `tsc` emits decorator metadata.
The bundle is a single CommonJS file, produced by esbuild. Native addons cannot be bundled, so they are gathered, with
what they load at run time, into a native tree. The tree also holds files that the application reads by path, which the
bundler does not follow: the scripts it runs separately (workers, worker pools, `fork()`,
`require(path.join(__dirname, 'x.js'))`) are bundled, and its data files and directories are copied. The builder finds
paths built from a module's location and rewrites them; whatever it cannot ship is listed in the result's `warnings`. At
run time, `resourcesPath()` from `lakutata` locates the application's resources, declared by `lakutata.resources` in its
`package.json`. Installers are configured by `lakutata.installer` in the same file. See `lakutata package bundle`,
`lakutata package exe` and `lakutata package installer` in the `@lakutata/cli` documentation.

NW.js applications run in the NW.js version specified by their `lakutata.nwjs`. `nwjsReleases()` lists NW.js releases,
`downloadNwjs()` downloads a runtime into the cache (verified against its release's checksums), and `stageNwjsApp()`
builds the application for NW.js: its bundle for the Node.js of that NW.js, its native addons made to load in it
(rebuilt for its architecture, or against its headers when they use the V8 API; on Windows, given the Node.js of NW.js),
its resources and the NW.js manifest. `buildNwjsApp()` puts it into the normal NW.js flavor, named after the
application, and `buildInstaller()` builds its installers with `"runtime": "nwjs"` (desktop application installers: dmg
on macOS, nsis on Windows, deb on Linux by default).

React Native mobile applications (Android, iOS, HarmonyOS) run in a libnode built from the Node.js sources by
lakutata/libnode. `downloadMobileNode()` downloads a system's libnode from its releases once (`LAKUTATA_LIBNODE_MIRROR`:
a mirror of them), verifies it against their checksums and keeps it in the cache (`LAKUTATA_MOBILE_NODE_DIR`: your own
libnode instead). `stageMobileApp()` creates the application's Node.js project: the bundle for the libnode's Node.js
(Node.js 24.20.0, `MOBILE_NODE_VERSION`, without a libnode), the resources, the manifest and an entry that removes
`fetch()` where WebAssembly is unavailable (HarmonyOS). It builds the native addons for the system from their sources,
against the libnode's headers and libraries: a native tree per Android architecture (node-gyp and the NDK), for iOS a
framework per addon for each SDK (Xcode) in the directory specified by the `frameworks` option, and for HarmonyOS a
library per addon (the DevEco Studio native SDK) in the HAP library directory specified by the `libraries` option. A
HarmonyOS HAP leaves files whose names start with a dot out of its resources, so on HarmonyOS the native tree is packed
into the project (`native.gz`, `native.json`) and extracted on its first run into the directory specified by
`LAKUTATA_NATIVE_DIR`.

## See also

- The guides on the website: [Packaging](https://lakutata.com/guide/Packaging) and
  [Installers](https://lakutata.com/guide/Installers).
