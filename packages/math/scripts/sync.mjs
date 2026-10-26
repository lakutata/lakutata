// The C and C++ libraries of @lakutata/math (packages/math/vendor): imported from their releases at a version, then
// brought to a newer one by a three-way merge of each of their files, which keeps the changes made to them in lakutata
// (as the source of TypeORM in @lakutata/orm, scripts/typeorm/sync.mjs). The base of the merge is the release imported
// before (vendor/UPSTREAM.json), fetched again; ours is the source in the package; theirs is the new release. A file not
// changed in lakutata takes the one of the new release, a file not changed upstream keeps ours, a file changed on both
// sides is merged by git merge-file: its conflicts are left in it with their markers, and listed. Only the files of
// each library the addon builds or needs (its licenses) are imported. The changes made in lakutata are described in
// vendor/PATCHES.md. The header of mpdecimal its configure would write is written in native/config/mpdecimal.
//
// Run: node scripts/sync.mjs <library> <version>      merge a newer release into the source of the package
//      node scripts/sync.mjs <library> <version> --import   replace the source of the package by a release, as it is
// The libraries: symengine, boost-multiprecision, boost-config, eigen, mpdecimal

import {execFileSync, spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const VENDOR = path.join(PACKAGE, 'vendor')
const UPSTREAM = path.join(VENDOR, 'UPSTREAM.json')

/**
 * The header of mpdecimal its configure writes from mpdecimal.h.in, written here: the configuration chosen by the size of
 * the pointers of the target when the header is read (64 or 32 bits), the build macros of libmpdec (CONFIG_64, ANSI,
 * HAVE_UINT128_T) given to its sources only, by binding.gyp
 * @param template the content of mpdecimal.h.in
 */
function mpdecimalHeader(template) {
    const configuration = `/* ABI: the size of the pointers of the target (written by scripts/sync.mjs of @lakutata/math, not by configure) */
#if defined(_WIN64) || defined(__LP64__) || (defined(__SIZEOF_POINTER__) && __SIZEOF_POINTER__ == 8)
  #define MPD_CONFIG_64 1
#else
  #define MPD_CONFIG_32 1
#endif`
    if (!template.includes('@MPD_HEADER_CONFIG@')) throw new Error('mpdecimal.h.in: @MPD_HEADER_CONFIG@ not found')
    return template.replace('@MPD_HEADER_CONFIG@', configuration)
}

/**
 * The libraries: where their releases are, the directory their archive extracts to, the files kept (paths from it,
 * a directory ending with /), the files left out of those (regular expressions on the same paths)
 */
const LIBRARIES = {
    'symengine': {
        directory: 'symengine',
        archive: (version) => `https://github.com/symengine/symengine/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `symengine-${version}`,
        include: ['symengine/', 'LICENSE', 'README.md', 'AUTHORS'],
        exclude: [
            /^symengine\/(tests|benchmarks)\//,
            /^symengine\/utilities\/(catch|matchpycpp|teuchos)\//,
            /^symengine\/parser\/sbml\//,
            /^symengine\/printers\/sbml\./,
            //The sources of the backends not built (their headers kept: the others include them, guarded inside)
            /^symengine\/(cwrapper|llvm_double|mp_wrapper|eval_arb|eval_mpfr|eval_mpc|real_mpfr|complex_mpc|series_flint|series_piranha)\.cpp$/,
            /^symengine\/polys\/uintpoly_(flint|piranha)\.cpp$/,
            /(^|\/)CMakeLists\.txt$/,
            /\.(in|yy|re|cmake)$/,
            /^symengine\/utilities\/(cereal|fast_float)\/.*\/(sandbox|unittests|tests?|doc|benchmarks?)\//
        ]
    },
    'boost-multiprecision': {
        directory: 'boost/multiprecision',
        archive: (version) => `https://github.com/boostorg/multiprecision/archive/refs/tags/Boost_${version.replaceAll('.', '_')}.tar.gz`,
        root: (version) => `multiprecision-Boost_${version.replaceAll('.', '_')}`,
        include: ['include/', 'README.md', 'LICENSE'],
        exclude: []
    },
    'boost-config': {
        directory: 'boost/config',
        archive: (version) => `https://github.com/boostorg/config/archive/refs/tags/boost-${version}.tar.gz`,
        root: (version) => `config-boost-${version}`,
        include: ['include/', 'README.md'],
        exclude: []
    },
    'eigen': {
        directory: 'eigen',
        archive: (version) => `https://gitlab.com/libeigen/eigen/-/archive/${version}/eigen-${version}.tar.gz`,
        root: (version) => `eigen-${version}`,
        include: ['Eigen/', 'COPYING.MPL2', 'COPYING.APACHE', 'COPYING.BSD', 'COPYING.README', 'README.md'],
        exclude: [/(^|\/)CMakeLists\.txt$/]
    },
    'mpdecimal': {
        directory: 'mpdecimal',
        archive: (version) => `https://www.bytereef.org/software/mpdecimal/releases/mpdecimal-${version}.tar.gz`,
        root: (version) => `mpdecimal-${version}`,
        include: ['libmpdec/', 'COPYRIGHT.txt', 'README.txt'],
        exclude: [/^libmpdec\/(bench|bench_full)\.c$/, /^libmpdec\/(examples|literature)\//, /^libmpdec\/(Makefile\.in|Makefile\.vc|vcdiv64\.asm|mpdecimal32vc\.h|mpdecimal64vc\.h)$/]
    }
}

/**
 * The files of a directory, deep: their paths from it ("/" separated)
 * @param directory
 */
function filesOf(directory) {
    const files = []
    const walk = (current, relative) => {
        for (const entry of readdirSync(current, {withFileTypes: true})) {
            const at = path.join(current, entry.name)
            const name = relative ? `${relative}/${entry.name}` : entry.name
            if (entry.isDirectory()) walk(at, name)
            else if (entry.isFile()) files.push(name)
        }
    }
    if (existsSync(directory)) walk(directory, '')
    return files.sort()
}

/**
 * The files of a release kept for a library, by their paths, and the sha-256 of its archive
 * @param library
 * @param version
 * @param work a temporary directory
 * @returns {{files: Map<string, Buffer>, sha256: string}}
 */
async function release(library, version, work) {
    const spec = LIBRARIES[library]
    const url = spec.archive(version)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
    const archive = Buffer.from(await response.arrayBuffer())
    const target = path.join(work, `${library}-${version}`)
    mkdirSync(target, {recursive: true})
    writeFileSync(path.join(target, 'archive.tar.gz'), archive)
    execFileSync('tar', ['-xzf', 'archive.tar.gz'], {cwd: target})
    const root = path.join(target, spec.root(version))
    const kept = (file) => spec.include.some((entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry) && !spec.exclude.some((pattern) => pattern.test(file))
    const files = new Map(filesOf(root).filter(kept).map((file) => [file, readFileSync(path.join(root, file))]))
    if (!files.size) throw new Error(`${url}: no file kept (${spec.root(version)}/ not found?)`)
    return {files, sha256: createHash('sha256').update(archive).digest('hex')}
}

/**
 * Write a file, its directories created
 * @param file
 * @param content
 */
function write(file, content) {
    mkdirSync(path.dirname(file), {recursive: true})
    writeFileSync(file, content)
}

/**
 * Remove the directories left empty under a directory
 * @param directory
 */
function pruneEmpty(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue
        const at = path.join(directory, entry.name)
        pruneEmpty(at)
        if (!readdirSync(at).length) rmSync(at, {recursive: true})
    }
}

const [library, version] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const importing = process.argv.includes('--import')
if (!LIBRARIES[library] || !version) throw new Error(`Run: node scripts/sync.mjs <${Object.keys(LIBRARIES).join('|')}> <version> [--import]`)
const upstream = existsSync(UPSTREAM) ? JSON.parse(readFileSync(UPSTREAM, 'utf8')) : {}
const destination = path.join(VENDOR, LIBRARIES[library].directory)
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-math-sync-'))
try {
    const theirs = await release(library, version, work)
    if (importing || !upstream[library]) {
        rmSync(destination, {recursive: true, force: true})
        for (const [file, content] of theirs.files) write(path.join(destination, file), content)
        console.log(`${library} ${version} imported: ${theirs.files.size} files`)
    } else {
        const base = await release(library, upstream[library].version, work)
        const ours = new Set(filesOf(destination))
        const conflicts = []
        const counts = {taken: 0, kept: 0, merged: 0, added: 0, removed: 0}
        for (const file of [...new Set([...base.files.keys(), ...theirs.files.keys(), ...ours])].sort()) {
            const at = path.join(destination, file)
            const baseContent = base.files.get(file)
            const theirContent = theirs.files.get(file)
            const ourContent = ours.has(file) ? readFileSync(at) : undefined
            const same = (a, b) => (a === undefined && b === undefined) || (a !== undefined && b !== undefined && a.equals(b))
            if (same(ourContent, baseContent)) {
                //Not changed in lakutata: the new release
                if (theirContent === undefined) {
                    if (ourContent !== undefined) rmSync(at)
                    counts.removed++
                } else if (!same(ourContent, theirContent)) {
                    write(at, theirContent)
                    counts[baseContent === undefined ? 'added' : 'taken']++
                }
            } else if (same(theirContent, baseContent)) {
                counts.kept++
            } else if (ourContent !== undefined && theirContent !== undefined && baseContent !== undefined) {
                const files = ['ours', 'base', 'theirs'].map((name) => path.join(work, `merge-${name}`))
                writeFileSync(files[0], ourContent)
                writeFileSync(files[1], baseContent)
                writeFileSync(files[2], theirContent)
                const merge = spawnSync('git', ['merge-file', '-L', 'lakutata', '-L', `${library} ${upstream[library].version}`, '-L', `${library} ${version}`, ...files])
                write(at, readFileSync(files[0]))
                counts.merged++
                if (merge.status !== 0) conflicts.push(file)
            } else {
                //Added on both sides, or removed on one side and changed on the other: left as it is in lakutata
                conflicts.push(`${file} (added, or removed and changed: left as it is)`)
            }
        }
        console.log(`${library} ${upstream[library].version} → ${version}: ${JSON.stringify(counts)}`)
        if (conflicts.length) console.log(`Conflicts to resolve:\n  ${conflicts.join('\n  ')}`)
    }
    pruneEmpty(destination)
    if (library === 'mpdecimal') write(path.join(PACKAGE, 'native', 'config', 'mpdecimal', 'mpdecimal.h'), mpdecimalHeader(readFileSync(path.join(destination, 'libmpdec', 'mpdecimal.h.in'), 'utf8')))
    upstream[library] = {version: version, archive: LIBRARIES[library].archive(version), sha256: theirs.sha256}
    write(UPSTREAM, `${JSON.stringify(Object.fromEntries(Object.entries(upstream).sort()), null, 2)}\n`)
} finally {
    rmSync(work, {recursive: true, force: true})
}
if (statSync(destination).isDirectory()) console.log(`→ ${path.relative(PACKAGE, destination)}`)
