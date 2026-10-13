// The finishing of the CommonJS build of a package (its build:cjs-pkg script, run in the package's directory): the
// package.json of dist/cjs marking its files as CommonJS, and the default of the entries required (the "require"
// conditions of the exports of the package.json) being the entry itself, not enumerated. tsc marks the entries with
// __esModule and gives them no default (the barrels have none), while the CommonJS interop of the bundlers (the
// _interopDefault of Rollup, the __importDefault of tsc) takes the default of a module marked __esModule: the SDKs
// bundled with lakutata 2.x (whose CommonJS entries were not marked) require lakutata through it, getting undefined
// otherwise.
//
// Run: node ../../scripts/package-build/cjs-package.mjs

import {readFileSync, writeFileSync, appendFileSync, globSync} from 'node:fs'
import path from 'node:path'

const DEFAULT_MARK = '//The default of the entry: the entry itself (scripts/package-build/cjs-package.mjs)'

writeFileSync('dist/cjs/package.json', JSON.stringify({type: 'commonjs'}))

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const entries = new Set()
const collect = (condition) => {
    if (typeof condition === 'string') return condition.endsWith('.js') && entries.add(condition)
    if (condition && typeof condition === 'object') Object.entries(condition).forEach(([key, value]) => key !== 'types' && collect(value))
}
//The imports of the package (#name/*, the imports of its package.json) in the CommonJS build: dist/cjs/package.json is
//the package scope of its files, without the imports of the package, which Node.js does not let point out of a scope (no
//.. in their targets). They are rewritten to the relative paths of their targets.
const imports = Object.entries(manifest.imports ?? {}).filter(([key, target]) => key.endsWith('/*') && typeof target === 'string' && target.endsWith('/*'))
for (const file of imports.length ? [...globSync('dist/cjs/**/*.js'), ...globSync('dist/cjs/**/*.d.ts')].map((file) => path.resolve(file)) : []) {
    const text = readFileSync(file, 'utf8')
    let rewritten = text
    for (const [key, target] of imports) {
        const relative = path.relative(path.dirname(file), path.resolve(target.slice(0, -1))).split(path.sep).join('/')
        for (const quote of ['\'', '"']) rewritten = rewritten.replaceAll(`${quote}${key.slice(0, -1)}`, `${quote}${relative.startsWith('.') ? relative : `./${relative}`}/`)
    }
    if (rewritten !== text) writeFileSync(file, rewritten)
}
for (const target of Object.values(manifest.exports ?? {})) collect(target?.require)
//The patterns of the subpaths (./helper/*) expanded to their files
for (const file of [...entries].flatMap((entry) => entry.includes('*') ? globSync(entry) : [entry]).map((entry) => path.resolve(entry))) {
    if (readFileSync(file, 'utf8').includes(DEFAULT_MARK)) continue
    appendFileSync(file, `\n${DEFAULT_MARK}\nif (!Object.prototype.hasOwnProperty.call(exports, 'default')) Object.defineProperty(exports, 'default', {value: exports})\n`)
}
