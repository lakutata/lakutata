// The release of the packages of the workspace (lakutata and @lakutata/*): the working tree clean, the packages rebuilt
// and checked, their version bumped (committed and tagged, not pushed), then published by npm, one after the other in
// the order of their dependencies, with the dist-tag of the channel. npm, not lerna publish: lerna asks for a one-time
// password when the registry asks for a second factor, npm authenticates in the browser. Lerna only lists the packages
// in the order of their dependencies (lerna list --toposort): the versions are bumped here. Run again once the version
// is tagged (a publication interrupted), it publishes the packages not published yet.
//
// The packages released: a patch (3.1.1 → 3.1.2) releases the packages changed since the tag of the last release
// (their tests apart), the ones never published, and the ones depending on them at a version their new one does not
// match. They take the version of the release, the others keep theirs: a package can go from 3.1.1 to 3.1.3. A minor
// or a major release, a prerelease, the release of a prerelease and --all release all the packages. A package released
// depends on the others at their exact version (dependencies) or at their patches (peerDependencies, devDependencies
// and optionalDependencies: ~3.1.1).
//
// Run: node scripts/publishing/release.mjs <alpha|beta|latest> [--version <version>] [--all] [--tag <dist-tag>]
//      [--registry <url>] [--skip-gates] [--dry-run]
// or:  npm run release -- [options] (the same for release:beta and release:alpha): without the --, npm takes --version
//      as its own option and prints its version
// alpha/beta: the next prerelease of the channel (3.0.0-beta.1 → 3.0.0-beta.2); the first one of a version is given
//             with --version (--version 3.1.2-beta.0)
// latest:     the release of the current prerelease (3.0.0-beta.4 → 3.0.0), else the next patch (3.1.1 → 3.1.2); a
//             minor or a major release is given with --version (--version 3.2.0)
// --all       releases all the packages in a patch too
// --tag       the dist-tag, the channel by default. A version lower than the one the dist-tag gives on the registry is
//             refused: a patch of an older minor version (3.1.5 once 3.2.0 is released) takes another dist-tag
//             (--tag latest-3.1)
// --registry  the registry published to: https://registry.npmjs.org/ by default (not the registry of the npm
//             configuration, a mirror maybe), another one to rehearse a release (a local registry, on a branch of its
//             own: its commit is deleted with the branch, its tag by git tag -d)
// --skip-gates does not run the checks (a rehearsal)
// --dry-run   prints the version and the packages released, then stops: nothing is built, bumped or published

import {execFile, execFileSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {parseArgs, promisify} from 'node:util'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const {values: options, positionals: [channel]} = parseArgs({
    allowPositionals: true,
    options: {
        'version': {type: 'string'},
        'all': {type: 'boolean', default: false},
        'tag': {type: 'string'},
        'registry': {type: 'string'},
        'skip-gates': {type: 'boolean', default: false},
        'dry-run': {type: 'boolean', default: false}
    }
})
//The checks run before the version is bumped: a failure leaves the repository as it was
const GATES = ['lint', 'test:unit', 'test:types', 'test:api-surface', 'test:api-docs', 'test:cjs-interop', 'test:installed']
//The files of a package neither published nor building it: their changes do not release it
const UNPUBLISHED = [/^src\/tests\//, /^test-env\//]
//The files out of the packages building them all: their changes release them all
const BUILD = [/^scripts\/package-build\//]
//The fields of the manifests naming the other packages of the workspace
const FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']

const REGISTRY = options.registry ?? 'https://registry.npmjs.org/'

/**
 * Run a command in the repository, its output shown
 * @param command
 * @param args
 * @param env the variables added to the environment
 * @param cwd
 */
function run(command, args, env = {}, cwd = ROOT) {
    console.log(`\n› ${command} ${args.join(' ')}${cwd === ROOT ? '' : ` (${path.relative(ROOT, cwd)})`}`)
    execFileSync(command, args, {cwd: cwd, stdio: 'inherit', env: {...process.env, ...env}})
}

/**
 * The output of git
 * @param args
 */
function git(args) {
    return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8'})
}

/**
 * Whether a version of a package is in the registry
 * @param name
 * @param version
 */
function published(name, version) {
    try {
        return execFileSync('npm', ['view', `${name}@${version}`, 'version', '--registry', REGISTRY], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() === version
    } catch {
        return false
    }
}

/**
 * The dist-tags of a package on the registry, undefined when it was never published
 * @param name
 */
async function distTags(name) {
    try {
        const {stdout} = await promisify(execFile)('npm', ['view', name, 'dist-tags', '--json', '--registry', REGISTRY], {cwd: ROOT, encoding: 'utf8'})
        return JSON.parse(stdout || '{}')
    } catch (error) {
        if (/E404/.test(`${error.stdout}${error.stderr}`)) return undefined
        throw new Error(`The dist-tags of ${name} cannot be read from ${REGISTRY}: ${error.stderr?.trim() || error.message}`, {cause: error})
    }
}

/**
 * The results of a task run on items, a few at a time
 * @param items
 * @param limit
 * @param task
 */
async function mapLimited(items, limit, task) {
    const results = new Array(items.length)
    let next = 0
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await task(items[index])
        }
    }))
    return results
}

/**
 * The numbers and the prerelease identifiers of a version, undefined when it is not one
 * @param version
 */
function parseVersion(version) {
    const matched = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
    return matched ? {numbers: matched.slice(1, 4).map(Number), prerelease: matched[4]?.split('.') ?? []} : undefined
}

/**
 * The order of two versions as semver gives it: negative when the first one is lower
 * @param first
 * @param second
 */
function compareVersions(first, second) {
    const [left, right] = [parseVersion(first), parseVersion(second)]
    for (let index = 0; index < 3; index++) if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] - right.numbers[index]
    //A release is greater than its prereleases
    if (!left.prerelease.length || !right.prerelease.length) return right.prerelease.length - left.prerelease.length
    for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
        const [a, b] = [left.prerelease[index], right.prerelease[index]]
        if (a === b) continue
        if (a === undefined || b === undefined) return a === undefined ? -1 : 1
        const [numberA, numberB] = [/^\d+$/.test(a), /^\d+$/.test(b)]
        if (numberA && numberB) return Number(a) - Number(b)
        if (numberA !== numberB) return numberA ? -1 : 1
        return a < b ? -1 : 1
    }
    return 0
}

/**
 * Whether a range of a manifest accepts a version of a package of the workspace: an exact version, or the patches of
 * one (~3.1.1). The other ranges accept none: the package naming it is released again, the range rewritten.
 * @param range
 * @param version
 */
function accepts(range, version) {
    if (range === version) return true
    const tilde = /^~(\d+\.\d+\.\d+)$/.exec(range)
    const [wanted, given] = [tilde && parseVersion(tilde[1]), parseVersion(version)]
    if (!wanted || !given || given.prerelease.length) return false
    return wanted.numbers[0] === given.numbers[0] && wanted.numbers[1] === given.numbers[1] && given.numbers[2] >= wanted.numbers[2]
}

/**
 * The version to release: the one given, or the next one of the channel
 * @param current
 */
function nextVersion(current) {
    if (options.version) return options.version
    const prerelease = current.match(/^(\d+\.\d+\.\d+)-([a-z]+)\.(\d+)$/)
    const release = current.match(/^(\d+)\.(\d+)\.(\d+)$/)
    //The release that follows: the one of the current prerelease, else the next patch
    const following = prerelease ? prerelease[1] : release ? `${release[1]}.${release[2]}.${Number(release[3]) + 1}` : undefined
    if (!following) throw new Error(`${current} is neither a release (3.1.1) nor a prerelease (3.1.2-beta.0): give the version to release with --version`)
    if (channel === 'latest') return following
    if (!prerelease || prerelease[2] !== channel) throw new Error(`${current} is not a prerelease of the channel ${channel}: give the first one with --version (--version ${following}-${channel}.0)`)
    return `${prerelease[1]}-${channel}.${Number(prerelease[3]) + 1}`
}

/**
 * The packages of the workspace published: their manifest, its file, their directory
 */
function workspacePackages() {
    return readdirSync(path.join(ROOT, 'packages'))
        .map((directory) => ({directory: directory, file: path.join(ROOT, 'packages', directory, 'package.json')}))
        .filter(({file}) => existsSync(file))
        .map((entry) => ({...entry, manifest: JSON.parse(readFileSync(entry.file, 'utf8'))}))
        .filter(({manifest}) => !manifest.private)
}

/**
 * The packages of a patch: the ones changed since the tag of the last release, the ones never published, the ones
 * depending on them at a version their new one does not match
 * @param packages
 * @param tags the dist-tags of the packages, undefined for the ones never published
 * @param current the version of the last release
 * @param version the version of the patch
 * @returns The reason of each package released, by its name
 */
function patchPackages(packages, tags, current, version) {
    const base = `v${current}`
    if (!git(['tag', '--list', base]).trim()) throw new Error(`The tag ${base} of the last release is not found: fetch the tags (git fetch --tags), or release all the packages (--all)`)
    const changed = git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean)
    const build = changed.find((file) => BUILD.some((pattern) => pattern.test(file)))
    if (build) return new Map(packages.map(({manifest}) => [manifest.name, `${build} builds all the packages`]))
    const released = new Map()
    for (const {directory, manifest} of packages) {
        const prefix = `packages/${directory}/`
        const files = changed.filter((file) => file.startsWith(prefix) && !UNPUBLISHED.some((pattern) => pattern.test(file.slice(prefix.length))))
        if (!tags.get(manifest.name)) released.set(manifest.name, 'never published')
        else if (files.length) released.set(manifest.name, `changed (${files.length} ${files.length === 1 ? 'file' : 'files'})`)
    }
    //The packages depending on a package released at a version its new one does not match, until none is added
    for (let added = true; added;) {
        added = false
        for (const {manifest} of packages) {
            if (released.has(manifest.name)) continue
            const dependency = FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {})).find(([name, range]) => released.has(name) && !accepts(range, version))
            if (!dependency) continue
            released.set(manifest.name, `depends on ${dependency[0]}@${dependency[1]}`)
            added = true
        }
    }
    if (!released.size) throw new Error(`No package changed since ${base}: nothing to release (--all releases all the packages)`)
    return released
}

/**
 * Give the packages released the version of the release, and the versions of the others they depend on; then commit
 * them with lerna.json, and tag the commit
 * @param packages
 * @param released
 * @param version
 */
function bump(packages, released, version) {
    //The version of each package once released
    const versions = new Map(packages.map(({manifest}) => [manifest.name, released.has(manifest.name) ? version : manifest.version]))
    const files = []
    for (const {file, manifest} of packages) {
        if (!released.has(manifest.name)) continue
        manifest.version = version
        for (const field of FIELDS) {
            for (const name of Object.keys(manifest[field] ?? {})) {
                if (versions.has(name)) manifest[field][name] = field === 'dependencies' ? versions.get(name) : `~${versions.get(name)}`
            }
        }
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
        files.push(path.relative(ROOT, file))
    }
    const lerna = path.join(ROOT, 'lerna.json')
    writeFileSync(lerna, `${JSON.stringify({...JSON.parse(readFileSync(lerna, 'utf8')), version: version}, null, 2)}\n`)
    run('git', ['add', 'lerna.json', ...files])
    run('git', ['commit', '-m', `chore: release v${version}`])
    run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`])
}

if (!['alpha', 'beta', 'latest'].includes(channel)) throw new Error('The channel is alpha, beta or latest')
if (git(['status', '--porcelain']).trim()) throw new Error('The working tree is not clean: commit or stash the changes first')
const current = JSON.parse(readFileSync(path.join(ROOT, 'lerna.json'), 'utf8')).version
//The version of the commit already tagged: its publication is resumed
const tagged = git(['tag', '--points-at', 'HEAD']).split('\n').includes(`v${current}`)
//The version tagged is of the channel released (a prerelease of it, or a release for latest): a release of another
//channel starts from it (3.0.0-beta.6 tagged, released as 3.0.0)
const ofChannel = channel === 'latest' ? !current.includes('-') : current.includes(`-${channel}.`)
const resumed = tagged && ofChannel && (!options.version || options.version === current)
const version = resumed ? current : nextVersion(current)
if (!parseVersion(version)) throw new Error(`${version} is not a version (3.2.0, 3.2.0-beta.0)`)
if (!resumed && compareVersions(version, current) <= 0) throw new Error(`${version} is not greater than ${current}, the version of the last release`)
if (channel === 'latest' && version.includes('-')) throw new Error(`${version} is a prerelease: release it with its channel`)
if (channel !== 'latest' && !version.includes(`-${channel}.`)) throw new Error(`${version} is not a prerelease of the channel ${channel}`)
const tag = options.tag ?? channel
console.log(resumed ? `Release ${version}, tagged already: the packages not published yet (dist-tag ${tag}, registry ${REGISTRY})` : `Release ${current} → ${version} (dist-tag ${tag}, registry ${REGISTRY})`)

const packages = workspacePackages()
const found = await mapLimited(packages, 8, ({manifest}) => distTags(manifest.name))
const tags = new Map(packages.map(({manifest}, index) => [manifest.name, found[index]]))
const [major, minor] = parseVersion(version).numbers
//A patch of a release releases the packages changed only
const partial = !resumed && !options.all && channel === 'latest' && !current.includes('-') && parseVersion(current).numbers[0] === major && parseVersion(current).numbers[1] === minor
//The packages released, with the reason of each one
let released
if (resumed) released = new Map(packages.filter(({manifest}) => manifest.version === version).map(({manifest}) => [manifest.name, 'given the version by the commit tagged']))
else if (partial) released = patchPackages(packages, tags, current, version)
else released = new Map(packages.map(({manifest}) => [manifest.name, 'all the packages']))
if (resumed || partial) {
    console.log(`\n${released.size} of the ${packages.length} packages:`)
    for (const [name, reason] of released) console.log(`  ${name}: ${reason}`)
} else {
    const why = options.all ? '--all' : channel !== 'latest' ? 'a prerelease' : current.includes('-') ? 'the release of a prerelease' : 'a minor or a major release'
    console.log(`\nAll the ${packages.length} packages (${why})`)
}
//The dist-tag does not go back to an older version
const newer = [...released.keys()].filter((name) => tags.get(name)?.[tag] && compareVersions(tags.get(name)[tag], version) > 0)
if (newer.length) {
    const named = newer.slice(0, 3).map((name) => `${name}@${tags.get(name)[tag]}`).join(', ')
    throw new Error(`The dist-tag ${tag} gives a version newer than ${version} on ${REGISTRY} (${named}${newer.length > 3 ? ` and ${newer.length - 3} more` : ''}): give the release another dist-tag (--tag ${tag}-${major}.${minor})`)
}

if (options['dry-run']) {
    console.log('\nDry run: nothing built, bumped or published')
} else {
    run('npm', ['run', 'rebuild'])
    if (!resumed) {
        if (!options['skip-gates']) for (const gate of GATES) run('npm', ['run', gate])
        bump(packages, released, version)
    }
    //The packages at the version of the release, in the order of their dependencies
    const ordered = JSON.parse(execFileSync('npx', ['lerna', 'list', '--toposort', '--json'], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}))
        .filter((entry) => entry.version === version)
    for (const {name, location} of ordered) {
        if (published(name, version)) {
            console.log(`\n${name}@${version} is published already`)
            continue
        }
        //The packages of the scope are public (a scoped package is restricted by default when first published)
        run('npm', ['publish', '--tag', tag, '--access', 'public', '--registry', REGISTRY], {}, location)
    }
    console.log(`\nReleased ${version} (${ordered.length} packages, dist-tag ${tag}): push the commit and the tag v${version} when ready (git push --follow-tags)`)
}
