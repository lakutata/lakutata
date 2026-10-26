// The release of the packages of the workspace (lakutata and @lakutata/*, one version, lerna in fixed mode): the working
// tree clean, the packages rebuilt and checked, their version bumped by lerna (committed and tagged, not pushed), then
// published by npm, one after the other in the order of their dependencies, with the dist-tag of the channel. npm, not
// lerna publish: lerna asks for a one-time password when the registry asks for a second factor, npm authenticates in the
// browser. Run again once the version is tagged (a publication interrupted), it publishes the packages not published yet.
//
// Run: node scripts/publishing/release.mjs <alpha|beta|latest> [--version <version>] [--registry <url>] [--skip-gates]
// or:  npm run release -- [--version <version>] (the same for release:beta and release:alpha): without the --, npm
//      takes --version as its own option and prints its version
// alpha/beta: the next prerelease of the channel (3.0.0-beta.1 → 3.0.0-beta.2); the first one of a version is given
//             with --version (--version 3.1.2-beta.0)
// latest:     the release of the current prerelease (3.0.0-beta.4 → 3.0.0), else the next patch (3.1.1 → 3.1.2); a
//             minor or a major release is given with --version (--version 3.2.0)
// --registry  the registry published to: https://registry.npmjs.org/ by default (not the registry of the npm
//             configuration, a mirror maybe), another one to rehearse a release (a local registry, on a branch of its own:
//             its commit and its tag are deleted with the branch)
// --skip-gates does not run the checks (a rehearsal)

import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync, renameSync} from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const {values: options, positionals: [channel]} = parseArgs({
    allowPositionals: true,
    options: {
        'version': {type: 'string'},
        'registry': {type: 'string'},
        'skip-gates': {type: 'boolean', default: false}
    }
})
//The checks run before the version is bumped: a failure leaves the repository as it was
const GATES = ['lint', 'test:unit', 'test:types', 'test:api-surface', 'test:api-docs', 'test:cjs-interop', 'test:installed']

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

if (!['alpha', 'beta', 'latest'].includes(channel)) throw new Error('The channel is alpha, beta or latest')
if (execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim()) throw new Error('The working tree is not clean: commit or stash the changes first')
const current = JSON.parse(readFileSync(new URL('../../lerna.json', import.meta.url), 'utf8')).version
//The version of the commit already tagged: its publication is resumed
const tagged = execFileSync('git', ['tag', '--points-at', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).split('\n').includes(`v${current}`)
//The version tagged is of the channel released (a prerelease of it, or a release for latest): a release of another
//channel starts from it (3.0.0-beta.6 tagged, released as 3.0.0)
const ofChannel = channel === 'latest' ? !current.includes('-') : current.includes(`-${channel}.`)
const resumed = tagged && ofChannel && (!options.version || options.version === current)
const version = resumed ? current : nextVersion(current)
if (channel === 'latest' && version.includes('-')) throw new Error(`${version} is a prerelease: release it with its channel`)
if (channel !== 'latest' && !version.includes(`-${channel}.`)) throw new Error(`${version} is not a prerelease of the channel ${channel}`)
console.log(resumed ? `Release ${version}, tagged already: the packages not published yet (dist-tag ${channel}, registry ${REGISTRY})` : `Release ${current} → ${version} (dist-tag ${channel}, registry ${REGISTRY})`)

run('npm', ['run', 'rebuild'])
if (!resumed) {
    if (!options['skip-gates']) for (const gate of GATES) run('npm', ['run', gate])
    //The lockfile of the workspace is not versioned (.gitignore): lerna would update it and add it to the commit
    const lockfile = path.join(ROOT, 'package-lock.json')
    const aside = `${lockfile}.release`
    if (existsSync(lockfile)) renameSync(lockfile, aside)
    try {
        run('npx', ['lerna', 'version', version, '--yes'])
    } finally {
        if (existsSync(aside)) renameSync(aside, lockfile)
    }
}
const packages = JSON.parse(execFileSync('npx', ['lerna', 'list', '--toposort', '--json'], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}))
for (const {name, location} of packages) {
    if (published(name, version)) {
        console.log(`\n${name}@${version} is published already`)
        continue
    }
    //The packages of the scope are public (a scoped package is restricted by default when first published)
    run('npm', ['publish', '--tag', channel, '--access', 'public', '--registry', REGISTRY], {}, location)
}
console.log(`\nReleased ${version}: push the commit and the tag v${version} when ready (git push --follow-tags)`)
