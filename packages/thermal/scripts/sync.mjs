// The C and C++ libraries and the fonts of @lakutata/thermal (packages/thermal/vendor): imported from their releases at a
// version, then brought to a newer one by a three-way merge of each of their files, which keeps the changes made to them
// in lakutata (as scripts/sync.mjs of @lakutata/barcode). The base of the merge is the release imported before
// (vendor/UPSTREAM.json), fetched again; ours is the source in the package; theirs is the new release. A file not
// changed in lakutata takes the one of the new release, a file not changed upstream keeps ours, a file changed on both
// sides is merged by git merge-file: its conflicts are left in it with their markers, and listed. Only the files of
// each library the addon builds or needs (its licenses) are imported. The changes made in lakutata are described in
// vendor/PATCHES.md. The fonts are files of a commit of their repository (its archive is gigabytes), each with its
// sha-256, replaced as a whole.
//
// Run: node scripts/sync.mjs <library> <version>            merge a newer release into the source of the package
//      node scripts/sync.mjs <library> <version> --import   replace the source of the package by a release, as it is
// The libraries: litehtml, freetype, plutovg, lunasvg, libunibreak (its version is the one of its tag: 8_0), noto (a
// commit of notofonts/noto-cjk)

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
 * The sources of C and C++ (the files the compilers read)
 */
const SOURCE = /\.(c|cc|cpp|h|hpp)$/

/**
 * The libraries: where their releases are, the directory their archive extracts to, the files kept (paths from it,
 * a directory ending with /), the files left out of those (regular expressions on the same paths)
 */
const LIBRARIES = {
    'litehtml': {
        directory: 'litehtml',
        archive: (version) => `https://github.com/litehtml/litehtml/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `litehtml-${version}`,
        include: ['include/', 'src/', 'LICENSE', 'README.md'],
        //Its sources and the license of its bundled gumbo (and the strings.h gumbo needs under MSVC), not its builds
        exclude: [/^(include|src)\/.*(?<!\.(c|cpp|h|hpp)|\/LICENSE)$/]
    },
    'freetype': {
        directory: 'freetype',
        archive: (version) => `https://download.savannah.gnu.org/releases/freetype/freetype-${version}.tar.gz`,
        root: (version) => `freetype-${version}`,
        //The modules the addon builds (native/config/ftmodule.h): OpenType (CFF) and TrueType fonts, their hinting, both
        //rasterizers, and the gzip module the SFNT driver calls (WOFF)
        include: ['include/', 'src/base/', 'src/cff/', 'src/sfnt/', 'src/truetype/', 'src/smooth/', 'src/raster/', 'src/autofit/',
            'src/psaux/', 'src/pshinter/', 'src/psnames/', 'src/gzip/', 'LICENSE.TXT', 'docs/FTL.TXT', 'README'],
        exclude: [/^(include|src)\/.*(?<!\.(c|h))$/]
    },
    'plutovg': {
        directory: 'plutovg',
        archive: (version) => `https://github.com/sammycage/plutovg/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `plutovg-${version}`,
        include: ['include/', 'source/', 'LICENSE', 'README.md'],
        exclude: []
    },
    'lunasvg': {
        directory: 'lunasvg',
        archive: (version) => `https://github.com/sammycage/lunasvg/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `lunasvg-${version}`,
        include: ['include/', 'source/', 'LICENSE', 'README.md'],
        exclude: []
    },
    'libunibreak': {
        directory: 'libunibreak',
        archive: (version) => `https://github.com/adah1972/libunibreak/archive/refs/tags/libunibreak_${version}.tar.gz`,
        root: (version) => `libunibreak-libunibreak_${version}`,
        include: ['src/', 'LICENCE', 'README.md'],
        //The line and grapheme breaking (UAX #14, UAX #29) and the tables they read, not the word breaking, the tests
        //and the generators of the tables
        exclude: [/^src\/(tests\.c|test_skips\.h|wordbreak)/, /^src\/.*(?<!\.(c|h))$/]
    },
    'noto': {
        directory: 'noto',
        //The Simplified Chinese subsets of Noto Sans CJK (Source Han Sans), regular and bold, and their license (SIL OFL 1.1)
        files: {
            'NotoSansSC-Regular.otf': 'Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
            'NotoSansSC-Bold.otf': 'Sans/SubsetOTF/SC/NotoSansSC-Bold.otf',
            'LICENSE': 'Sans/LICENSE'
        },
        file: (version, file) => `https://raw.githubusercontent.com/notofonts/noto-cjk/${version}/${file}`
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
 * The bytes of a URL
 * @param url
 */
async function download(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
}

/**
 * The files of a release kept for a library, by their paths, and the sha-256 of its archive (of each file for the
 * libraries of files)
 * @param library
 * @param version
 * @param work a temporary directory
 * @returns {Promise<{files: Map<string, Buffer>, sha256: string | Record<string, string>}>}
 */
async function release(library, version, work) {
    const spec = LIBRARIES[library]
    if (spec.files) {
        const files = new Map()
        const sha256 = {}
        for (const [name, file] of Object.entries(spec.files)) {
            const content = await download(spec.file(version, file))
            files.set(name, content)
            sha256[name] = createHash('sha256').update(content).digest('hex')
        }
        return {files, sha256}
    }
    const url = spec.archive(version)
    const archive = await download(url)
    const target = path.join(work, `${library}-${version}`)
    mkdirSync(target, {recursive: true})
    writeFileSync(path.join(target, 'archive.tar.gz'), archive)
    execFileSync('tar', ['-xzf', 'archive.tar.gz'], {cwd: target})
    const root = path.join(target, spec.root(version))
    const kept = (file) => spec.include.some((entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry) && !spec.exclude.some((pattern) => pattern.test(file))
    const files = new Map(filesOf(root).filter(kept).map((file) => [file, readFileSync(path.join(root, file))]))
    if (!files.size) throw new Error(`${url}: no file kept (${spec.root(version)}/ not found?)`)
    if (![...files.keys()].some((file) => SOURCE.test(file))) throw new Error(`${url}: no source kept`)
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
const spec = LIBRARIES[library]
const destination = path.join(VENDOR, spec.directory)
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-thermal-sync-'))
try {
    const theirs = await release(library, version, work)
    //The fonts (binary files) are replaced as a whole: they are never changed in lakutata
    if (importing || !upstream[library] || spec.files) {
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
    upstream[library] = spec.files
        ? {version: version, files: Object.fromEntries(Object.entries(spec.files).map(([name, file]) => [name, {url: spec.file(version, file), sha256: theirs.sha256[name]}]))}
        : {version: version, archive: spec.archive(version), sha256: theirs.sha256}
    write(UPSTREAM, `${JSON.stringify(Object.fromEntries(Object.entries(upstream).sort()), null, 2)}\n`)
} finally {
    rmSync(work, {recursive: true, force: true})
}
if (statSync(destination).isDirectory()) console.log(`→ ${path.relative(PACKAGE, destination)}`)
