// The source of s2js in src/lib/s2, from its archive extracted (vendor/UPSTREAM.json): its directories r1, r2, r3, s1
// and s2, without their tests, their test helpers (testing*.ts) and their barrels (_index.ts), each file changed as
// vendor/PATCHES.md lists (a notice of the change at its top, .js on its import specifiers, bigfloat replaced by
// ExactFloat, a type the compiler settings of the package need); its LICENSE. src/lib/s2/r3/ExactFloat.ts is ours, kept.
//
// Run: node scripts/s2-vendor.mjs <the directory s2js-1.44.0 of the archive extracted>
import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [from] = process.argv.slice(2)
if (!from) throw new Error('node scripts/s2-vendor.mjs <the directory s2js-1.44.0 of the archive extracted>')
const into = path.join(root, 'src/lib/s2')
const ours = readFileSync(path.join(into, 'r3/ExactFloat.ts'))
rmSync(into, {recursive: true, force: true})
const NOTICE = '// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md\n'

/**
 * A file changed: its text, the text of a part of it replaced
 * @param text
 * @param file
 * @param before
 * @param after
 */
function replaced(text, file, before, after) {
    if (!text.includes(before)) throw new Error(`${file}: ${before} not found`)
    return text.replace(before, after)
}

let count = 0
for (const directory of ['r1', 'r2', 'r3', 's1', 's2']) {
    mkdirSync(path.join(into, directory), {recursive: true})
    for (const file of readdirSync(path.join(from, directory))) {
        if (!file.endsWith('.ts') || file.endsWith('_test.ts') || file.startsWith('testing') || file === '_index.ts') continue
        let text = readFileSync(path.join(from, directory, file), 'utf8')
        // The modules of the package are ES modules resolved by Node.js: their files named
        text = text.replace(/(from\s+'|export \* as \w+ from\s+')(\.\.?\/[^']+?)(?<!\.js)'/g, (_, head, specifier) => `${head}${specifier}.js'`)
        if (file === 'PreciseVector.ts')
            text = replaced(text, file, "import { BigFloat32 as BigFloat } from 'bigfloat'", "import { ExactFloat as BigFloat } from './ExactFloat.js'")
        // noImplicitAny is off: an empty array would be never[]
        if (file === 'Cap.ts') text = replaced(text, file, '      const cellIDs = []\n', '      const cellIDs: CellID[] = []\n')
        if (/from '(?!\.)/.test(text)) throw new Error(`${directory}/${file}: an import of another package`)
        writeFileSync(path.join(into, directory, file), NOTICE + text)
        count++
    }
}
writeFileSync(path.join(into, 'r3/ExactFloat.ts'), ours)
writeFileSync(path.join(into, 'LICENSE'), readFileSync(path.join(from, 'LICENSE')))
console.log(`src/lib/s2: ${count} files of s2js`)
