// The versions of Node.js the published packages run on (apis.mjs, TARGETS): the sources of the packages (src, the
// vendored sources of orm; not the tests, nor the templates) must not use an API of apis.mjs one of the versions lacks,
// unless they check for it first. A line checking for an API (or using it behind such a check) says so with a comment
// on the line or the line before: //node-compat: <api> (a note), the API as apis.mjs names it, several separated by commas.
//
// Run: node scripts/node-compat/check.mjs [--list]
// --list prints the entries of apis.mjs with the targets lacking them

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'
import {APIS, TARGETS, available} from './apis.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PACKAGES = path.join(ROOT, 'packages')
const SOURCE = /\.(ts|mts|cts|js|mjs|cjs)$/
const MARKER = /\/\/\s*node-compat:\s*(.+?)\s*$/

const {values: args} = parseArgs({options: {list: {type: 'boolean', default: false}}})

/**
 * The entries of apis.mjs with the targets lacking them
 */
const checked = APIS.map(entry => ({...entry, missing: TARGETS.filter(target => !available(entry.added, target))}))

if (args.list) {
    for (const entry of checked) console.log(`${entry.api.padEnd(40)} ${entry.source.padEnd(10)} added ${entry.added.join(', ').padEnd(24)} missing in ${entry.missing.join(', ') || '-'}`)
    process.exit(0)
}

/**
 * The source files of the published packages
 */
function sources() {
    const files = []
    const walk = directory => {
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const at = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                if (!['node_modules', 'tests', 'dist'].includes(entry.name)) walk(at)
            } else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                files.push(at)
            }
        }
    }
    for (const name of readdirSync(PACKAGES).sort()) {
        const directory = path.join(PACKAGES, name)
        if (name.startsWith('template') || !statSync(directory).isDirectory()) continue
        const manifest = path.join(directory, 'package.json')
        if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).private) continue
        for (const sub of ['src', 'vendor']) if (existsSync(path.join(directory, sub))) walk(path.join(directory, sub))
    }
    return files
}

/**
 * Whether a file declares a name (an import, a variable, a parameter): its uses are not the global ones
 */
function declares(text, name) {
    return new RegExp(`\\bimport\\s+(\\*\\s+as\\s+)?${name}\\b|\\bimport\\s*(type\\s*)?\\{[^}]*\\bas\\s+${name}\\b[^}]*\\}|\\b(const|let|var)\\s+${name}\\b`).test(text)
}

const problems = []
const marked = new Set()
for (const file of sources()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/')
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, index) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return
        const markers = [line, lines[index - 1] ?? ''].map(l => l.match(MARKER)?.[1]).filter(Boolean)
        for (const entry of checked) {
            if (!entry.missing.length || !entry.pattern.test(line)) continue
            if (entry.allow?.some(allowed => allowed.file === relative)) continue
            if (entry.binding && declares(text, entry.binding) && !/globalThis\./.test(line)) continue
            if (markers.some(marker => marker.split(/\s*,\s*/).some(name => name === entry.api || name.startsWith(`${entry.api} (`)))) {
                marked.add(`${relative}:${index + 1}`)
                continue
            }
            problems.push(`${relative}:${index + 1}: ${entry.api} (added ${entry.added.join(', ')}; missing in ${entry.missing.join(', ')})\n    ${line.trim().slice(0, 160)}`)
        }
    })
}

if (problems.length) {
    console.error(`node-compat: ${problems.length} use(s) of APIs that Node.js ${TARGETS.join(' or ')} lacks, without a check for them (scripts/node-compat/check.mjs):`)
    for (const problem of problems) console.error(problem)
    process.exit(1)
}
console.log(`node-compat: the published packages run on Node.js ${TARGETS.join(' and ')} (${marked.size} checked use(s))`)
