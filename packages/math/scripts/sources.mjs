// The sources of a target of binding.gyp, one by line, from the package's directory: gyp reads them by
// <!@(node scripts/sources.mjs <target>) when the addon is built, so the list follows the vendored libraries
// (scripts/sync.mjs) without being written by hand. Run when the package is installed: Node.js only.
//
// Run: node scripts/sources.mjs <symengine|mpdecimal|math>

import {readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/**
 * The targets: the directory of their sources, their extensions, the files left out (included by another source)
 */
const TARGETS = {
    symengine: {directory: 'vendor/symengine/symengine', extensions: /\.(cpp|cc)$/, exclude: new Set(['vendor/symengine/symengine/as_real_imag.cpp'])},
    mpdecimal: {directory: 'vendor/mpdecimal/libmpdec', extensions: /\.c$/, exclude: new Set()},
    math: {directory: 'native', extensions: /\.cpp$/, exclude: new Set()}
}

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

const target = TARGETS[process.argv[2]]
if (!target) throw new Error(`Run: node scripts/sources.mjs <${Object.keys(TARGETS).join('|')}>`)
console.log(filesOf(target.directory).filter((file) => target.extensions.test(file) && !target.exclude.has(file)).sort().join('\n'))
