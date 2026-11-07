// The sources of a target of binding.gyp, one by line, from the package's directory: gyp reads them by
// <!@(node scripts/sources.mjs <target>) when the addon is built, so the lists follow the vendored libraries
// (scripts/sync.mjs) without being written by hand. Run when the package is installed: Node.js only.
//
// Run: node scripts/sources.mjs <freetype|litehtml|gumbo|plutovg|lunasvg|unibreak|qrcodegen|thermal>

import {readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/**
 * The files of a directory, not deep, from the package's directory ("/" separated)
 * @param directory
 */
function filesOf(directory) {
    return readdirSync(path.join(PACKAGE, directory), {withFileTypes: true}).filter((entry) => entry.isFile()).map((entry) => `${directory}/${entry.name}`)
}

/**
 * The targets: their sources
 */
const TARGETS = {
    //The compilation units of the modules of native/config/ftmodule.h (each includes the other files of its module), and
    //the parts of the base layer the addon calls (FreeType's docs/INSTALL.ANY)
    freetype: () => ['base/ftsystem.c', 'base/ftinit.c', 'base/ftdebug.c', 'base/ftbase.c', 'base/ftbbox.c', 'base/ftglyph.c',
        'base/ftbitmap.c', 'base/ftmm.c', 'base/ftsynth.c', 'cff/cff.c', 'sfnt/sfnt.c', 'truetype/truetype.c', 'smooth/smooth.c',
        'raster/raster.c', 'autofit/autofit.c', 'psaux/psaux.c', 'pshinter/pshinter.c', 'psnames/psnames.c', 'gzip/ftgzip.c']
        .map((file) => `vendor/freetype/src/${file}`),
    litehtml: () => filesOf('vendor/litehtml/src').filter((file) => file.endsWith('.cpp')),
    gumbo: () => filesOf('vendor/litehtml/src/gumbo').filter((file) => file.endsWith('.c')),
    plutovg: () => filesOf('vendor/plutovg/source').filter((file) => file.endsWith('.c')),
    lunasvg: () => filesOf('vendor/lunasvg/source').filter((file) => file.endsWith('.cpp')),
    //The tables its other sources #include (emojidata.c, graphemebreakdata.c...) are not compiled apart
    unibreak: () => filesOf('vendor/libunibreak/src').filter((file) => file.endsWith('.c') && !/(emojidata|eastasianwidthdata|graphemebreakdata|indicconjunctbreakdata|linebreakauxdata)\.c$/.test(file)),
    qrcodegen: () => ['vendor/qrcodegen/c/qrcodegen.c'],
    //The addon: the sources of native/, not of its subdirectories
    thermal: () => filesOf('native').filter((file) => file.endsWith('.cpp'))
}

const target = TARGETS[process.argv[2]]
if (!target) throw new Error(`Run: node scripts/sources.mjs <${Object.keys(TARGETS).join('|')}>`)
console.log(target().sort().join('\n'))
