// The C and C++ libraries of @lakutata/barcode (packages/barcode/vendor): imported from their releases at a version,
// then brought to a newer one by a three-way merge of each of their files, which keeps the changes made to them in
// lakutata (as scripts/sync.mjs of @lakutata/math). The base of the merge is the release imported before
// (vendor/UPSTREAM.json), fetched again; ours is the source in the package; theirs is the new release. A file not
// changed in lakutata takes the one of the new release, a file not changed upstream keeps ours, a file changed on both
// sides is merged by git merge-file: its conflicts are left in it with their markers, and listed. Only the files of
// each library the addon builds or needs (its licenses) are imported. The changes made in lakutata are described in
// vendor/PATCHES.md.
// For zxing-cpp, the files its CMake build compiles with the readers only (ZXING_READERS on, ZXING_WRITERS off) are
// listed in native/config/zxing/sources.json, and the header its CMake build writes from Version.h.in is written in
// native/config/zxing/Version.h: the package is built by node-gyp, without CMake.
//
// Run: node scripts/sync.mjs <library> <version>            merge a newer release into the source of the package
//      node scripts/sync.mjs <library> <version> --import   replace the source of the package by a release, as it is
// The libraries: zint, zxing-cpp, wuffs, stb (its version is a commit)

import {execFileSync, spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const VENDOR = path.join(PACKAGE, 'vendor')
const UPSTREAM = path.join(VENDOR, 'UPSTREAM.json')
const ZXING_CONFIG = path.join(PACKAGE, 'native', 'config', 'zxing')

/**
 * The libraries: where their releases are, the directory their archive extracts to, the files kept (paths from it,
 * a directory ending with /), the files left out of those (regular expressions on the same paths)
 */
const LIBRARIES = {
    'zint': {
        directory: 'zint',
        archive: (version) => `https://downloads.sourceforge.net/project/zint/zint/${version}/zint-${version}-src.tar.gz`,
        root: (version) => `zint-${version}-src`,
        include: ['backend/', 'LICENSE', 'README'],
        //The encoding library only (the BSD part): its C sources and headers (the fonts of its SVG and raster outputs
        //are headers in backend/fonts), not its tests, tools and builds
        exclude: [/^backend\/(tests|tools)\//, /^backend\/(fonts\/)?[^/]+$(?<!\.[ch])/]
    },
    'zxing-cpp': {
        directory: 'zxing-cpp',
        archive: (version) => `https://github.com/zxing-cpp/zxing-cpp/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `zxing-cpp-${version}`,
        include: ['core/src/', 'LICENSE', 'README.md'],
        //Its bundled copy of zint serves its writers, not built (zint is a library of the package)
        exclude: [/^core\/src\/libzint\//],
        //Read to write native/config/zxing, not kept
        build: ['core/CMakeLists.txt', 'core/Version.h.in']
    },
    'wuffs': {
        directory: 'wuffs',
        archive: (version) => `https://github.com/google/wuffs/archive/refs/tags/v${version}.tar.gz`,
        root: (version) => `wuffs-${version}`,
        //The single C file of its 0.4 release (another major version names another file)
        include: ['release/c/wuffs-v0.4.c', 'LICENSE', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md'],
        exclude: []
    },
    'stb': {
        directory: 'stb',
        archive: (version) => `https://github.com/nothings/stb/archive/${version}.tar.gz`,
        root: (version) => `stb-${version}`,
        include: ['stb_image_write.h', 'LICENSE', 'README.md'],
        exclude: []
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
 * The files of a release kept for a library, by their paths, the files its build reads, and the sha-256 of its archive
 * @param library
 * @param version
 * @param work a temporary directory
 * @returns {Promise<{files: Map<string, Buffer>, build: Map<string, string>, sha256: string}>}
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
    const build = new Map((spec.build ?? []).map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
    return {files, build, sha256: createHash('sha256').update(archive).digest('hex')}
}

/**
 * The variables of the CMake build of zxing-cpp with its readers only (a variable not listed is false)
 */
const ZXING_VARIABLES = {
    ZXING_READERS: true,
    ZXING_ENABLE_1D: true,
    ZXING_ENABLE_AZTEC: true,
    ZXING_ENABLE_DATAMATRIX: true,
    ZXING_ENABLE_MAXICODE: true,
    ZXING_ENABLE_PDF417: true,
    ZXING_ENABLE_QRCODE: true,
    ZXING_USE_BUNDLED_ZINT: true
}

/**
 * The value of a condition of CMake (`if (A OR (B AND NOT C))`) over the variables of the build: NOT, AND, OR and
 * parentheses; the other tests (DEFINED, MATCHES, STREQUAL...) are false
 * @param condition
 */
function cmakeCondition(condition) {
    const tokens = condition.replace(/\$\{(\w+)\}/g, '$1').match(/\(|\)|"[^"]*"|[^\s()]+/g) ?? []
    let at = 0
    const primary = () => {
        const token = tokens[at++]
        if (token === '(') {
            const value = or()
            at++
            return value
        }
        if (token === 'NOT') return !primary()
        if (token === 'DEFINED') {
            at++
            return false
        }
        //A binary test (A MATCHES "x", A STREQUAL B): false
        if (['MATCHES', 'STREQUAL', 'VERSION_LESS', 'VERSION_GREATER', 'EQUAL', 'LESS', 'GREATER'].includes(tokens[at])) {
            at += 2
            return false
        }
        return ZXING_VARIABLES[token] === true || token === 'ON' || token === 'TRUE'
    }
    const and = () => {
        let value = primary()
        while (tokens[at] === 'AND') {
            at++
            value = primary() && value
        }
        return value
    }
    const or = () => {
        let value = and()
        while (tokens[at] === 'OR') {
            at++
            value = and() || value
        }
        return value
    }
    return or()
}

/**
 * The sources the CMake build of zxing-cpp compiles with its readers only: the files under src/ named in the branches
 * of its conditions taken (generator expressions $<$<BOOL:${VAR}>:src/...> by their variable), by their paths from
 * core/
 * @param cmake the content of core/CMakeLists.txt
 */
function zxingSources(cmake) {
    const sources = new Set()
    //The branches: [taken now, one taken already] for each if
    const branches = []
    const active = () => branches.every(([taken]) => taken)
    for (const line of cmake.split('\n')) {
        const statement = line.replace(/#.*$/, '').trim()
        let match
        if ((match = /^if\s*\((.*)\)\s*$/i.exec(statement))) {
            const value = cmakeCondition(match[1])
            branches.push([value, value])
        } else if ((match = /^elseif\s*\((.*)\)\s*$/i.exec(statement))) {
            const branch = branches[branches.length - 1]
            const value = !branch[1] && cmakeCondition(match[1])
            branch[0] = value
            branch[1] ||= value
        } else if (/^else\s*\(\s*\)\s*$/i.test(statement)) {
            const branch = branches[branches.length - 1]
            branch[0] = !branch[1]
            branch[1] = true
        } else if (/^endif\s*\(/i.test(statement)) {
            branches.pop()
        } else if (active()) {
            const plain = statement.replace(/\$<\$<BOOL:\$\{(\w+)\}>:(src\/[^>]+)>/g, (_, variable, file) => ZXING_VARIABLES[variable] ? file : '')
            for (const file of plain.match(/src\/[\w/.-]+\.(?:c|cpp)\b/g) ?? []) sources.add(file)
        }
    }
    return [...sources].sort()
}

/**
 * The configuration of zxing-cpp its CMake build writes: Version.h from Version.h.in (the readers, every symbology, no
 * writer, no experimental API), and the list of its sources compiled (native/config/zxing/sources.json)
 * @param build the files the build reads
 * @param files the files kept
 * @param version
 */
function writeZxingConfig(build, files, version) {
    const [major, minor, patch] = version.split('.')
    const header = build.get('core/Version.h.in')
        .replace(/^#cmakedefine01 (\w+)$/gm, (_, name) => `#define ${name} ${ZXING_VARIABLES[name] ? 1 : 0}`)
        .replace(/^#cmakedefine (\w+)$/gm, (_, name) => ZXING_VARIABLES[name] ? `#define ${name}` : `/* #undef ${name} */`)
        .replaceAll('@PROJECT_VERSION_MAJOR@', major)
        .replaceAll('@PROJECT_VERSION_MINOR@', minor)
        .replaceAll('@PROJECT_VERSION_PATCH@', patch)
        .replaceAll('@ZXING_VERSION_SUFFIX@', '')
    if (/@\w+@|#cmakedefine/.test(header)) throw new Error('Version.h.in: a variable not replaced')
    write(path.join(ZXING_CONFIG, 'Version.h'), `/* Written by scripts/sync.mjs of @lakutata/barcode from Version.h.in (the readers only), not by CMake */\n${header}`)
    const sources = zxingSources(build.get('core/CMakeLists.txt'))
    for (const source of sources) if (!files.has(`core/${source}`)) throw new Error(`core/${source}: listed by CMakeLists.txt, not in the release`)
    if (!sources.includes('src/ReadBarcode.cpp') || sources.some((source) => source.startsWith('src/libzint/') || source.endsWith('MultiFormatWriter.cpp'))) throw new Error('core/CMakeLists.txt: the sources of the readers not found as expected')
    write(path.join(ZXING_CONFIG, 'sources.json'), `${JSON.stringify({
        cpp: sources.filter((source) => source.endsWith('.cpp')).map((source) => `vendor/zxing-cpp/core/${source}`),
        c: sources.filter((source) => source.endsWith('.c')).map((source) => `vendor/zxing-cpp/core/${source}`)
    }, null, 2)}\n`)
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
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-barcode-sync-'))
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
    if (library === 'zxing-cpp') writeZxingConfig(theirs.build, theirs.files, version)
    upstream[library] = {version: version, archive: LIBRARIES[library].archive(version), sha256: theirs.sha256}
    write(UPSTREAM, `${JSON.stringify(Object.fromEntries(Object.entries(upstream).sort()), null, 2)}\n`)
} finally {
    rmSync(work, {recursive: true, force: true})
}
if (statSync(destination).isDirectory()) console.log(`→ ${path.relative(PACKAGE, destination)}`)
