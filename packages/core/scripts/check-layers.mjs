/**
 * Layering gate for @lakutata/core.
 *
 * Every source file belongs to a layer (and a group inside that layer).
 * A file may import from a lower layer, or from its own group; any other
 * internal import (including `import type`) is a violation.
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

/**
 * [path prefix relative to src, layer, group]
 * The longest matching prefix wins, so single files can override their directory.
 */
const LAYERS = [
    //L0 - primitives: no internal dependencies except each other
    ['constants', 0, 'primitives'],
    ['lib/helpers', 0, 'primitives'],
    ['interfaces/IConstructor.ts', 0, 'primitives'],
    ['interfaces/IPatRun.ts', 0, 'primitives'],
    ['types/ActionPattern.ts', 0, 'primitives'],
    ['types/ClassDecorator.ts', 0, 'primitives'],
    ['types/MethodDecorator.ts', 0, 'primitives'],
    ['types/ParameterDecorator.ts', 0, 'primitives'],
    ['types/PropertyDecorator.ts', 0, 'primitives'],
    ['types/JSONSchema.ts', 0, 'primitives'],
    //L1 - foundation: exception base class, runtime basic info
    ['lib/foundation', 1, 'foundation'],
    ['exceptions', 1, 'foundation'],
    //L2 - engines
    ['lib/ioc', 2, 'ioc'],
    ['lib/validation', 2, 'validation'],
    //L3 - DTO: schema based validation of objects, properties and methods
    ['lib/dto', 3, 'dto'],
    ['decorators/dto', 3, 'dto'],
    //L4 - object model
    ['lib/base', 4, 'model'],
    ['lib/core', 4, 'model'],
    ['decorators/di', 4, 'model'],
    ['decorators/asst', 4, 'model'],
    ['options', 4, 'model'],
    ['types', 4, 'model'],
    ['interfaces', 4, 'model'],
    ['dto', 4, 'model'],
    //L5 - built-in components & providers (independent of each other)
    ['components/ConsoleLogger.ts', 5, 'logger'],
    ['components/monitor', 5, 'monitor'],
    //L6 - application
    ['lib/app', 6, 'app'],
    //L7 - public barrels & tests
    ['exports', 7, 'exports'],
    ['tests', 7, 'tests']
]

function classify(relFile) {
    let best
    for (const entry of LAYERS) {
        const prefix = entry[0]
        if (relFile === prefix || relFile.startsWith(prefix.endsWith('.ts') ? prefix : `${prefix}/`)) {
            if (!best || prefix.length > best[0].length) best = entry
        }
    }
    return best ? {layer: best[1], group: best[2]} : undefined
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, out)
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
    }
    return out
}

const toRel = (file) => path.relative(srcDir, file).split(path.sep).join('/')
const violations = []
const unclassified = new Set()

for (const file of walk(srcDir)) {
    const rel = toRel(file)
    const from = classify(rel)
    if (!from) {
        unclassified.add(rel)
        continue
    }
    const {importedFiles} = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true)
    for (const {fileName} of importedFiles) {
        if (!fileName.startsWith('.')) continue
        const targetRel = toRel(path.resolve(path.dirname(file), fileName.replace(/\.js$/, '.ts')))
        const to = classify(targetRel)
        if (!to) {
            unclassified.add(targetRel)
            continue
        }
        if (to.layer < from.layer || to.group === from.group) continue
        violations.push(`${rel} (L${from.layer}:${from.group}) -> ${targetRel} (L${to.layer}:${to.group})`)
    }
}

for (const rel of unclassified) console.error(`unclassified: ${rel}`)
for (const v of violations) console.error(`violation: ${v}`)
if (violations.length || unclassified.size) {
    console.error(`\nLayer check failed: ${violations.length} violation(s), ${unclassified.size} unclassified file(s).`)
    process.exit(1)
}
console.log('Layer check passed.')
