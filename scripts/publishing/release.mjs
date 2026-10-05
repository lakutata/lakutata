// The release of the packages of the workspace (lakutata and @lakutata/*, one version, lerna in fixed mode): the working
// tree clean, the packages rebuilt and checked, their version bumped by lerna (committed and tagged, not pushed), then
// published from their package.json with the dist-tag of the channel.
//
// Run: node scripts/publishing/release.mjs <alpha|beta|latest> [--version <version>] [--registry <url>] [--skip-gates]
// alpha/beta: the next prerelease of the channel (3.0.0-beta.1 → 3.0.0-beta.2); the first one of a version is given
//             with --version (--version 3.0.0-beta.0)
// latest:     the release of the current prerelease (3.0.0-beta.4 → 3.0.0), or the version given
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
 */
function run(command, args, env = {}) {
    console.log(`\n› ${command} ${args.join(' ')}`)
    execFileSync(command, args, {cwd: ROOT, stdio: 'inherit', env: {...process.env, ...env}})
}

/**
 * The version to release: the one given, or the next one of the channel
 * @param current
 */
function nextVersion(current) {
    if (options.version) return options.version
    const prerelease = current.match(/^(\d+\.\d+\.\d+)-([a-z]+)\.(\d+)$/)
    if (channel === 'latest') {
        if (!prerelease) throw new Error(`${current} is not a prerelease: give the version to release with --version`)
        return prerelease[1]
    }
    if (!prerelease || prerelease[2] !== channel) throw new Error(`${current} is not a prerelease of the channel ${channel}: give the first one with --version (--version 3.0.0-${channel}.0)`)
    return `${prerelease[1]}-${channel}.${Number(prerelease[3]) + 1}`
}

if (!['alpha', 'beta', 'latest'].includes(channel)) throw new Error('The channel is alpha, beta or latest')
if (execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim()) throw new Error('The working tree is not clean: commit or stash the changes first')
const current = JSON.parse(readFileSync(new URL('../../lerna.json', import.meta.url), 'utf8')).version
const version = nextVersion(current)
if (channel === 'latest' && version.includes('-')) throw new Error(`${version} is a prerelease: release it with its channel`)
if (channel !== 'latest' && !version.includes(`-${channel}.`)) throw new Error(`${version} is not a prerelease of the channel ${channel}`)
console.log(`Release ${current} → ${version} (dist-tag ${channel}, registry ${REGISTRY})`)

run('npm', ['run', 'rebuild'])
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
//The packages of the scope are public (a scoped package is restricted by default when first published)
run('npx', ['lerna', 'publish', 'from-package', '--yes', '--dist-tag', channel, '--registry', REGISTRY], {npm_config_access: 'public'})
console.log(`\nReleased ${version}: push the commit and the tag v${version} when ready (git push --follow-tags)`)
