// The verification of a release, before it is published: the packages are published to a local registry (verdaccio, in
// Docker, the other packages coming from npmjs) with a prerelease version and a tag of their own, as a prerelease is
// published; a clean node container then installs the tool from it, creates the projects of the templates, builds and
// tests them (consumer.sh); the Docker images of the templates are built from the registry and run, the packages of Linux
// of the templates (Dockerfile.installer) made from it and installed.
// The repository is not changed: the versions are given to the packed packages.
//
// Run: node scripts/verify-release/verify.mjs [--version 3.0.0-verify.1] [--tag verify] [--templates "service cli"]
//      [--skip-build] [--skip-images] [--keep]
// Needs Docker and the access to registry.npmjs.org.

import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))
const {values: options} = parseArgs({
    options: {
        'version': {type: 'string', default: '3.0.0-verify.1'},
        'tag': {type: 'string', default: 'verify'},
        'templates': {type: 'string', default: 'default cli service web-react web-vue web-next web-nuxt electron-react electron-vue'},
        'node': {type: 'string', default: '22'},
        'skip-build': {type: 'boolean', default: false},
        'skip-images': {type: 'boolean', default: false},
        'keep': {type: 'boolean', default: false}
    }
})
const CONTAINER = 'lakutata-verify-registry'
const PORT = 4873
const LOCAL = `http://localhost:${PORT}`
//The registry seen from the containers and the builds of the images
const REGISTRY = `http://host.docker.internal:${PORT}/`
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-verify-'))
const results = []

/**
 * Print a step
 * @param message
 */
function Step(message) {
    console.log(`\n\x1b[36m━━ ${message}\x1b[0m`)
}

/**
 * Run a command, its output shown
 * @param command
 * @param args
 * @param options
 */
function Run(command, args, options = {}) {
    const result = spawnSync(command, args, {stdio: 'inherit', ...options})
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`)
}

/**
 * Run a command, its output given back
 * @param command
 * @param args
 * @param options
 */
function Output(command, args, options = {}) {
    return execFileSync(command, args, {encoding: 'utf8', ...options}).trim()
}

/**
 * Wait for a condition
 * @param check
 * @param timeout
 */
async function Until(check, timeout = 60000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
        try {
            if (await check()) return
        } catch {
            //Not yet
        }
        await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Timed out')
}

/**
 * The version of a range of a package of the repository: the prerelease version
 * @param range
 */
function Range(range) {
    const matched = /^(\^|~|>=|=)?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.exec(range)
    return matched ? `${matched[1] ?? ''}${options.version}` : range
}

/**
 * Start the registry, give back the token of its user
 */
async function StartRegistry() {
    Step(`The registry: verdaccio on ${LOCAL} (lakutata from it, the other packages from npmjs)`)
    spawnSync('docker', ['rm', '-f', CONTAINER], {stdio: 'ignore'})
    Run('docker', ['run', '-d', '--name', CONTAINER, '-p', `${PORT}:4873`, '-v', `${path.join(HERE, 'verdaccio.yaml')}:/verdaccio/conf/config.yaml:ro`, 'verdaccio/verdaccio:6'], {stdio: ['ignore', 'ignore', 'inherit']})
    await Until(async () => (await fetch(`${LOCAL}/-/ping`)).ok)
    const response = await fetch(`${LOCAL}/-/user/org.couchdb.user:verify`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'verify', password: 'verify-release'})
    })
    const {token} = await response.json()
    if (!token) throw new Error(`The user of the registry cannot be created: ${response.status}`)
    return token
}

/**
 * Pack the packages of the repository, give them the prerelease version and publish them with the tag
 * @param token
 */
function Publish(token) {
    Step(`Publish the packages as ${options.version} (tag ${options.tag})`)
    const npmrc = path.join(work, '.npmrc')
    writeFileSync(npmrc, `registry=${LOCAL}/\n//localhost:${PORT}/:_authToken=${token}\n`)
    const packs = path.join(work, 'packs')
    mkdirSync(packs)
    const published = []
    for (const directory of readdirSync(path.join(ROOT, 'packages'))) {
        const source = path.join(ROOT, 'packages', directory)
        if (!existsSync(path.join(source, 'package.json'))) continue
        const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
        if (manifest.private) continue
        //The files npm publishes, unpacked
        const tarball = Output('npm', ['pack', '--silent', '--pack-destination', packs], {cwd: source}).split('\n').at(-1)
        const unpacked = path.join(packs, directory)
        mkdirSync(unpacked)
        Run('tar', ['-xzf', path.join(packs, tarball), '-C', unpacked, '--strip-components=1'])
        const packed = JSON.parse(readFileSync(path.join(unpacked, 'package.json'), 'utf8'))
        packed.version = options.version
        for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
            for (const name of Object.keys(packed[field] ?? {})) {
                if (name === 'lakutata' || name.startsWith('@lakutata/')) packed[field][name] = Range(packed[field][name])
            }
        }
        //The registry of the verification only: the publishConfig of a package gives it the one of npmjs, which the
        //command line and the user configuration do not override
        if (packed.publishConfig) delete packed.publishConfig.registry
        writeFileSync(path.join(unpacked, 'package.json'), `${JSON.stringify(packed, null, 2)}\n`)
        const target = Output('npm', ['config', 'get', 'registry', '--userconfig', npmrc, '--registry', `${LOCAL}/`], {cwd: unpacked})
        if (!target.startsWith(LOCAL) || JSON.parse(readFileSync(path.join(unpacked, 'package.json'), 'utf8')).publishConfig?.registry) {
            throw new Error(`${packed.name} would be published to ${target}: the verification publishes to ${LOCAL} only`)
        }
        Run('npm', ['publish', unpacked, '--tag', options.tag, '--ignore-scripts', '--userconfig', npmrc, '--registry', `${LOCAL}/`], {stdio: ['ignore', 'ignore', 'inherit'], env: {...process.env, npm_config_registry: `${LOCAL}/`}})
        published.push(packed.name)
    }
    console.log(`${published.length} packages: ${published.join(', ')}`)
}

/**
 * The users: a clean node container installs the tool, creates, builds and tests the projects (consumer.sh)
 */
function Consumer() {
    Step(`The users: node:${options.node} with the registry ${REGISTRY}`)
    const status = spawnSync('docker', [
        'run', '--rm',
        '--add-host=host.docker.internal:host-gateway',
        '-v', `${work}:/work`,
        '-v', `${HERE}:/verify:ro`,
        '-e', `npm_config_registry=${REGISTRY}`,
        '-e', `VERIFY_TAG=${options.tag}`,
        '-e', `VERIFY_TEMPLATES=${options.templates}`,
        `node:${options.node}`,
        'bash', '/verify/consumer.sh'
    ], {stdio: 'inherit'}).status
    if (status !== 0) results.push(`FAIL users: the container exited with ${status}`)
    if (existsSync(path.join(work, 'results.txt'))) results.push(...readFileSync(path.join(work, 'results.txt'), 'utf8').trim().split('\n').filter(Boolean))
}

/**
 * The deb of an Electron template packaged for linux/arm64 in a container (Dockerfile.installer, npm run package:linux),
 * from the registry: installed in a clean Debian, started in a virtual display, its page read with the DevTools protocol
 * @param template
 * @param project
 */
function Cross(template, project) {
    Step(`The cross build of ${template}: linux/arm64`)
    writeFileSync(path.join(project, '.npmrc'), `registry=${REGISTRY}\n`)
    let started = Date.now()
    const output = path.join(project, 'dist', 'installer', 'arm64')
    const packaged = spawnSync('docker', ['buildx', 'build', '--platform', 'linux/arm64', '--add-host=host.docker.internal:host-gateway', '--file', 'Dockerfile.installer', '--output', `type=local,dest=${output}`, '.'], {cwd: project, stdio: 'inherit'}).status === 0
    const debs = packaged && existsSync(output) ? readdirSync(output).filter(file => file.endsWith('.deb')) : []
    results.push(`${debs.length === 1 ? 'PASS' : 'FAIL'} ${template}: cross build of the deb (${Math.round((Date.now() - started) / 1000)}s)`)
    if (debs.length !== 1) return
    started = Date.now()
    const run = spawnSync('docker', [
        'run', '--rm', '--platform', 'linux/arm64',
        '-v', `${output}:/deb:ro`,
        '-v', `${HERE}:/verify:ro`,
        'node:22-trixie', 'sh', '/verify/electron-deb.sh', `/deb/${debs[0]}`
    ], {encoding: 'utf8'})
    //The output of the application (the pulls of the image are on stderr)
    console.log(run.stdout.trim().split('\n').slice(-15).join('\n'))
    if (run.status !== 0) console.log(run.stderr.trim().split('\n').slice(-15).join('\n'))
    const shown = /PAGE: .*Hello, verify-/.test(run.stdout) && /isolated: true/.test(run.stdout)
    results.push(`${shown ? 'PASS' : 'FAIL'} ${template}: the deb installed and started, its page shown (${Math.round((Date.now() - started) / 1000)}s)`)
}

/**
 * The packages of Linux of a project created with the installer feature, made by its Dockerfile.installer from the
 * registry: the deb installed in a clean Debian, its program run (the command of the cli template, the service of the
 * others: its /health, its page)
 * @param template
 * @param project
 */
function Installers(template, project) {
    Step(`The installers of ${template}: Dockerfile.installer`)
    writeFileSync(path.join(project, '.npmrc'), `registry=${REGISTRY}\n`)
    const output = path.join(project, 'dist', 'installer', 'linux')
    let started = Date.now()
    const built = spawnSync('docker', ['buildx', 'build', '--add-host=host.docker.internal:host-gateway', '--file', 'Dockerfile.installer', '--output', `type=local,dest=${output}`, '.'], {cwd: project, stdio: 'inherit'}).status === 0
    const files = built && existsSync(output) ? readdirSync(output) : []
    const made = ['.deb', '.rpm', '.tar.gz'].every(extension => files.some(file => file.endsWith(extension)))
    results.push(`${made ? 'PASS' : 'FAIL'} ${template}: the packages of Linux (${files.join(', ') || 'none'}, ${Math.round((Date.now() - started) / 1000)}s)`)
    const deb = files.find(file => file.endsWith('.deb'))
    if (!deb) return
    started = Date.now()
    const kind = template === 'cli' ? 'cli' : 'service'
    const run = spawnSync('docker', ['run', '--rm', '-v', `${output}:/packages:ro`, '-v', `${HERE}:/verify:ro`, 'debian:12', 'sh', '/verify/installer-deb.sh', `/packages/${deb}`, kind], {encoding: 'utf8'})
    console.log(run.stdout.trim().split('\n').slice(-12).map(line => line.slice(0, 300)).join('\n'))
    if (run.status !== 0) console.log(run.stderr.trim().split('\n').slice(-15).join('\n'))
    const ran = kind === 'cli'
        ? new RegExp(`OUTPUT: Hello, deb!`).test(run.stdout)
        : /HEALTH: \S/.test(run.stdout) && (!template.startsWith('web-') || /PAGE: .*<(div id="(root|app|__nuxt)"|h1)/.test(run.stdout))
    results.push(`${ran ? 'PASS' : 'FAIL'} ${template}: the deb installed, its program run (${Math.round((Date.now() - started) / 1000)}s)`)
}

/**
 * The Docker images of the templates having a Dockerfile: built from the registry, then run; the packages of Linux of
 * the templates created with their installer feature, the ones of the Electron templates
 */
async function Images() {
    for (const template of options.templates.split(/\s+/)) {
        const project = path.join(work, 'projects', `verify-${template}`)
        if (template.startsWith('electron-') && existsSync(path.join(project, 'Dockerfile.installer'))) {
            Cross(template, project)
            continue
        }
        if (existsSync(path.join(project, 'Dockerfile.installer'))) Installers(template, project)
        if (!existsSync(path.join(project, 'Dockerfile'))) continue
        const image = `lakutata-verify-${template}`
        Step(`The image of ${template}`)
        //The build installs from the registry (the lock file has its URLs)
        writeFileSync(path.join(project, '.npmrc'), `registry=${REGISTRY}\n`)
        const started = Date.now()
        const built = spawnSync('docker', ['build', '--add-host=host.docker.internal:host-gateway', '-t', image, project], {stdio: 'inherit'}).status === 0
        results.push(`${built ? 'PASS' : 'FAIL'} ${template}: image build (${Math.round((Date.now() - started) / 1000)}s)`)
        if (!built) continue
        const container = Output('docker', ['run', '-d', '-P', image])
        try {
            const port = Output('docker', ['port', container, '8080/tcp']).split('\n')[0].split(':').at(-1)
            let health = false
            try {
                await Until(async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok, 60000)
                health = true
            } catch {
                console.log(Output('docker', ['logs', container]))
            }
            results.push(`${health ? 'PASS' : 'FAIL'} ${template}: image runs (/health)`)
            if (template.startsWith('web-')) {
                const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {Accept: 'text/html'}}).catch(() => undefined)
                const page = response ? await response.text() : ''
                const served = response?.status === 200 && /<(div id="(root|app)"|h1)/.test(page)
                results.push(`${served ? 'PASS' : 'FAIL'} ${template}: image serves the pages`)
                if (!served) console.log(response?.status, page.slice(0, 500))
            }
        } finally {
            spawnSync('docker', ['rm', '-f', container], {stdio: 'ignore'})
            spawnSync('docker', ['rmi', image], {stdio: 'ignore'})
        }
    }
}

let failed = true
try {
    if (!options['skip-build']) {
        Step('Build the packages')
        Run('npm', ['run', 'build'], {cwd: ROOT})
    }
    const token = await StartRegistry()
    Publish(token)
    Consumer()
    if (!options['skip-images']) await Images()
    Step('Results')
    for (const result of results) console.log(result.startsWith('PASS') ? `\x1b[32m${result}\x1b[0m` : `\x1b[31m${result}\x1b[0m`)
    failed = !results.length || results.some(result => !result.startsWith('PASS'))
    console.log(`\n${results.filter(result => result.startsWith('PASS')).length} passed, ${results.filter(result => !result.startsWith('PASS')).length} failed; the projects and the logs: ${work}`)
} catch (error) {
    console.error(error)
} finally {
    if (!options.keep) spawnSync('docker', ['rm', '-f', CONTAINER], {stdio: 'ignore'})
    else console.log(`The registry is kept: ${LOCAL} (docker rm -f ${CONTAINER})`)
}
process.exit(failed ? 1 : 0)
