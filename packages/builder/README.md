# @lakutata/builder

The builder of the applications of the lakutata framework, used by the `bundle` and `executable` commands of
`@lakutata/cli`, and usable from the scripts of a project:

```js
import {BuildExecutable, BuildInstaller, BundleProject} from '@lakutata/builder'

//dist/<name>.cjs, run by node, its native addons and its resources next to it
await BundleProject({project: process.cwd()})
//dist/<name>, which runs without Node.js: Node.js (by default) or Bun embedded, one file or a directory
await BuildExecutable({project: process.cwd(), runtime: 'node', layout: 'directory'})
//dist/installer: the installers of the platform (deb, rpm, apk, archlinux, tar.gz on Linux; pkg, tar.gz on macOS;
//nsis, msi, zip on Windows), its service registered
await BuildInstaller({project: process.cwd()})
```

The application is compiled first (`tsc`, which emits the metadata of the decorators). The bundle is one CommonJS file
(esbuild); the native addons, which cannot be bundled, are gathered with what they load at run time into a native tree;
the resources of the application (the `lakutata.resources` of its `package.json`) are found at run time by
`ResourcesPath()` of lakutata. The installers are configured by the `lakutata.installer` of the `package.json`. See the
documentation of `lakutata bundle`, `lakutata executable` and `lakutata installer` in `@lakutata/cli`.

The installers of Linux are tested in containers (Docker): `npm run test:installer` makes them on Debian and Alpine,
installs, upgrades and removes them on Debian and Fedora (systemd) and Alpine (OpenRC). The ones of macOS are installed
in a virtual machine of macOS (`npm run test:installer:mac`, tart), the ones of Windows on Windows as an administrator
(`LAKUTATA_WINDOWS_INSTALL=1 npm run test:installer:windows`).
