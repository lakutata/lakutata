# @lakutata/builder

The builder of the applications of the lakutata framework, used by the `bundle` and `executable` commands of
`@lakutata/cli`, and usable from the scripts of a project:

```js
import {BundleProject, BuildExecutable} from '@lakutata/builder'

//dist/<name>.cjs, run by node, its native addons and its resources next to it
await BundleProject({project: process.cwd()})
//dist/<name>, which runs without Node.js: Node.js (by default) or Bun embedded, one file or a directory
await BuildExecutable({project: process.cwd(), runtime: 'node', layout: 'directory'})
```

The application is compiled first (`tsc`, which emits the metadata of the decorators). The bundle is one CommonJS file
(esbuild); the native addons, which cannot be bundled, are gathered with what they load at run time into a native tree;
the resources of the application (the `lakutata.resources` of its `package.json`) are found at run time by
`ResourcesPath()` of lakutata. See the documentation of `lakutata bundle` and `lakutata executable` in `@lakutata/cli`.
