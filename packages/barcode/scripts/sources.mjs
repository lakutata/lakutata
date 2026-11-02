// The sources of a target of binding.gyp, one by line, from the package's directory: gyp reads them by
// <!@(node scripts/sources.mjs <target>) when the addon is built, so the lists follow the vendored libraries
// (scripts/sync.mjs) without being written by hand. Run when the package is installed: Node.js only.
//
// Run: node scripts/sources.mjs <zint|zxing|zueci|codecs|barcode>

import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/**
 * The files of a directory, deep, from the package's directory ("/" separated)
 * @param directory
 */
function filesOf(directory) {
    return readdirSync(path.join(PACKAGE, directory), {withFileTypes: true}).flatMap((entry) => {
        const relative = `${directory}/${entry.name}`
        return entry.isDirectory() ? filesOf(relative) : [relative]
    })
}

/**
 * The sources of zxing-cpp its CMake build compiles with the readers only (native/config/zxing/sources.json, written
 * by scripts/sync.mjs)
 */
function zxing() {
    return JSON.parse(readFileSync(path.join(PACKAGE, 'native/config/zxing/sources.json'), 'utf8'))
}

/**
 * The targets: their sources
 */
const TARGETS = {
    //The encoding library of zint, its PNG output left out (it needs libpng: the PNG is written by stb_image_write)
    zint: () => filesOf('vendor/zint/backend').filter((file) => file.endsWith('.c') && file !== 'vendor/zint/backend/png.c'),
    zxing: () => zxing().cpp,
    zueci: () => zxing().c,
    //The implementations of wuffs and stb_image_write (native/codecs)
    codecs: () => filesOf('native/codecs').filter((file) => /\.(cpp|c)$/.test(file)),
    //The addon: the sources of native/, not of its subdirectories
    barcode: () => filesOf('native').filter((file) => /^native\/[^/]+\.cpp$/.test(file))
}

const target = TARGETS[process.argv[2]]
if (!target) throw new Error(`Run: node scripts/sources.mjs <${Object.keys(TARGETS).join('|')}>`)
console.log(target().sort().join('\n'))
