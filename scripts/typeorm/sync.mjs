// The source of TypeORM in @lakutata/orm (packages/orm/typeorm): imported from the repository of TypeORM at a tag, then
// brought to a newer tag by a three-way merge of each of its files, which keeps the changes made to it in lakutata. The
// base of the merge is the source of the tag imported before (UPSTREAM.json), fetched again; ours is the source in the
// package; theirs is the source of the new tag. A file not changed in lakutata takes the one of the new tag, a file not
// changed upstream keeps ours, a file changed on both sides is merged by git merge-file: its conflicts are left in it
// with their markers, and listed. The files of lakutata in the directory (UPSTREAM.json, README.md, package.json) are not
// in the source of TypeORM: they are kept.
//
// The source of TypeORM is the one of its package typeorm (packages/typeorm/src, src before TypeORM 1.1.2), and of its package
// @typeorm/legacy-naming-strategies (packages/legacy-naming-strategies/src, in legacy-naming-strategies), whose imports of
// typeorm are rewritten to the source beside it: the base and the new tag are rewritten alike, the merge sees no change.
//
// Run: node scripts/typeorm/sync.mjs <tag> [--target <directory>]
// --target merges into another directory than packages/orm/typeorm (to try an upgrade on a copy)

import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, rmdirSync, globSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REPOSITORY = 'https://github.com/typeorm/typeorm.git'
const SOURCES = [
    {from: ['packages/typeorm/src', 'src'], to: '.'},
    {
        from: ['packages/legacy-naming-strategies/src'],
        to: 'legacy-naming-strategies',
        rewrite: (text) => text.replace(/from "typeorm"/g, 'from "../index"').replace(/from "typeorm\/([^"]+)"/g, 'from "../$1"')
    }
]
const LICENSE = 'LICENSE'
const UPSTREAM = 'UPSTREAM.json'

const {values: args, positionals} = parseArgs({
    allowPositionals: true,
    options: {target: {type: 'string', default: path.join(ROOT, 'packages', 'orm', 'typeorm')}}
})
const tag = positionals[0]
if (!tag) {
    console.error('Usage: node scripts/typeorm/sync.mjs <tag> [--target <directory>]')
    process.exit(2)
}
const target = path.resolve(args.target)
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-typeorm-'))

/**
 * Clone the repository of TypeORM at a tag
 * @param name
 */
function clone(name) {
    const directory = path.join(work, `clone-${name}`)
    execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', name, REPOSITORY, directory], {stdio: 'pipe'})
    return {directory, commit: execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD']).toString().trim()}
}

/**
 * The source of TypeORM in a clone, as the package holds it: path -> content
 * @param directory
 */
function sourceOf(directory) {
    const files = new Map()
    for (const source of SOURCES) {
        const from = source.from.map((candidate) => path.join(directory, candidate)).find((candidate) => existsSync(candidate))
        if (!from) continue
        for (const file of globSync('**/*', {cwd: from, withFileTypes: true})) {
            if (!file.isFile()) continue
            const relative = path.relative(from, path.join(file.parentPath, file.name))
            const text = readFileSync(path.join(from, relative), 'utf8')
            files.set(path.join(source.to, relative).split(path.sep).join('/'), source.rewrite ? source.rewrite(text) : text)
        }
    }
    files.set(LICENSE, readFileSync(path.join(directory, LICENSE), 'utf8'))
    return files
}

/**
 * The files of the package which are source of TypeORM (not the files of lakutata in the directory)
 * @param base
 * @param theirs
 */
function oursOf(base, theirs) {
    const files = new Map()
    if (!existsSync(target)) return files
    for (const file of globSync('**/*', {cwd: target, withFileTypes: true})) {
        if (!file.isFile()) continue
        const relative = path.relative(target, path.join(file.parentPath, file.name)).split(path.sep).join('/')
        if (base.has(relative) || theirs.has(relative)) files.set(relative, readFileSync(path.join(target, relative), 'utf8'))
    }
    return files
}

/**
 * Write a file of the package
 * @param relative
 * @param text
 */
function write(relative, text) {
    mkdirSync(path.dirname(path.join(target, relative)), {recursive: true})
    writeFileSync(path.join(target, relative), text)
}

/**
 * Remove a file of the package, and its directories left empty
 * @param relative
 */
function remove(relative) {
    rmSync(path.join(target, relative))
    let directory = path.dirname(path.join(target, relative))
    while (directory !== target && readdirSync(directory).length === 0) {
        rmdirSync(directory)
        directory = path.dirname(directory)
    }
}

/**
 * Merge three versions of a file: the text merged and its number of conflicts
 * @param ours
 * @param base
 * @param theirs
 */
function merge(ours, base, theirs) {
    const files = ['ours', 'base', 'theirs'].map((name, index) => {
        const file = path.join(work, `merge-${name}`)
        writeFileSync(file, [ours, base, theirs][index])
        return file
    })
    try {
        return {text: execFileSync('git', ['merge-file', '-p', '-L', 'lakutata', '-L', 'base', '-L', `typeorm ${tag}`, ...files]).toString(), conflicts: 0}
    } catch (error) {
        //git merge-file exits with the number of conflicts, the text merged on its output
        if (typeof error.status === 'number' && error.status > 0 && error.stdout) return {text: error.stdout.toString(), conflicts: error.status}
        throw error
    }
}

try {
    const upstreamFile = path.join(target, UPSTREAM)
    const upstream = existsSync(upstreamFile) ? JSON.parse(readFileSync(upstreamFile, 'utf8')) : undefined
    const next = clone(tag)
    const theirs = sourceOf(next.directory)
    const counts = {added: 0, updated: 0, merged: 0, removed: 0, kept: 0}
    const conflicts = []
    if (!upstream) {
        //The first import: the directory takes the source of the tag
        if (existsSync(target) && oursOf(theirs, theirs).size) throw new Error(`${target} already holds a source of TypeORM without ${UPSTREAM}`)
        for (const [relative, text] of theirs) write(relative, text)
        counts.added = theirs.size
    } else {
        const base = sourceOf(clone(upstream.tag).directory)
        const ours = oursOf(base, theirs)
        for (const relative of new Set([...base.keys(), ...theirs.keys(), ...ours.keys()])) {
            const [b, t, o] = [base.get(relative), theirs.get(relative), ours.get(relative)]
            if (o === t) continue
            if (b === t) {
                counts.kept++
            } else if (o === b) {
                if (t === undefined) {
                    remove(relative)
                    counts.removed++
                } else {
                    write(relative, t)
                    b === undefined ? counts.added++ : counts.updated++
                }
            } else if (b !== undefined && t !== undefined && o !== undefined) {
                const result = merge(o, b, t)
                write(relative, result.text)
                counts.merged++
                if (result.conflicts) conflicts.push(`${relative}: ${result.conflicts} conflict(s)`)
            } else {
                //Added on both sides, or removed on one side and changed on the other: ours kept, theirs beside it
                if (t !== undefined) write(`${relative}.typeorm-${tag}`, t)
                conflicts.push(`${relative}: ${o === undefined ? 'removed in lakutata' : t === undefined ? 'removed in TypeORM' : 'added on both sides'}, changed on the other side${t !== undefined ? ` (TypeORM's in ${relative}.typeorm-${tag})` : ''}`)
            }
        }
    }
    writeFileSync(upstreamFile, `${JSON.stringify({repository: REPOSITORY, tag: tag, commit: next.commit, sources: SOURCES.map(({from, to}) => ({from, to}))}, null, 2)}\n`)
    console.log(`TypeORM ${upstream ? `${upstream.tag} -> ` : ''}${tag} (${next.commit.slice(0, 10)}) in ${path.relative(ROOT, target) || target}: ${Object.entries(counts).map(([name, count]) => `${count} ${name}`).join(', ')}`)
    if (conflicts.length) {
        console.log(`${conflicts.length} conflict(s) to resolve:\n${conflicts.map((conflict) => `  ${conflict}`).join('\n')}`)
        process.exitCode = 1
    }
} finally {
    rmSync(work, {recursive: true, force: true})
}
