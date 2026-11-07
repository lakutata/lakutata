// The loading of the addon in each build (the build:addon script, after tsc): dist/*/lib/Addon.js written as a
// function that requires build/Release/thermal_printer.node by a path from the module at its first use, in the forms
// the builder of lakutata follows when it packs an application (a URL from import.meta.url in the ES modules, a path
// from __dirname in CommonJS). The addon exists on macOS and Windows only; it is built here when it was not.
//
// Run: node scripts/addon.mjs

import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const native = process.platform === 'darwin' || process.platform === 'win32'

// The addon not built yet (the scripts of the installation skipped): built now, with the node-gyp of npm, else the
// one installed
if (native && !existsSync(path.join(root, 'build/Release/thermal_printer.node'))) {
    const gyp = process.env.npm_config_node_gyp || createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js')
    const built = spawnSync(process.execPath, [gyp, 'rebuild'], {cwd: root, stdio: 'inherit'})
    if (built.status !== 0) throw new Error('The addon of @lakutata/thermal-printer could not be built (node-gyp rebuild)')
}

// The addon not built (its install script not run): an error telling how to build it
const MISSING = 'The addon of @lakutata/thermal-printer (build/Release/thermal_printer.node) is not built: the install script of the package did not run. Bun and pnpm run it only for the dependencies they trust (trustedDependencies in the package.json for Bun, pnpm approve-builds for pnpm): allow it, then install again or run npm rebuild @lakutata/thermal-printer.'
const NONE = 'The addon of @lakutata/thermal-printer exists on macOS and Windows only'

await writeFile(path.join(root, 'dist/esm/lib/Addon.js'), `import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
let loaded;
export function loadAddon() {
    if (loaded) return loaded;
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error(${JSON.stringify(NONE)});
    try {
        loaded = createRequire(import.meta.url)(fileURLToPath(new URL('../../../build/Release/thermal_printer.node', import.meta.url)));
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND') throw new Error(${JSON.stringify(MISSING)}, {cause: error});
        throw error;
    }
    return loaded;
}
`)
await writeFile(path.join(root, 'dist/cjs/lib/Addon.js'), `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAddon = loadAddon;
let loaded;
function loadAddon() {
    if (loaded) return loaded;
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error(${JSON.stringify(NONE)});
    try {
        loaded = require(require("node:path").join(__dirname, "..", "..", "..", "build", "Release", "thermal_printer.node"));
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND') throw new Error(${JSON.stringify(MISSING)}, {cause: error});
        throw error;
    }
    return loaded;
}
`)
