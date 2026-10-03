import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The installers are made and installed in containers (Docker): the packages of the systems of the glibc on Debian,
 * the ones of Alpine (musl) on Alpine; their services run by systemd (Debian, Fedora) and OpenRC (Alpine)
 */
const DOCKER: boolean = process.env.LAKUTATA_DOCKER === '1'

/**
 * The directory of the builder package
 */
const BUILDER: string = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Run a command, its output given back; it must succeed
 * @param command
 * @param args
 * @param input
 * @param cwd
 */
function Must(command: string, args: string[], input?: string, cwd?: string): string {
    const result = spawnSync(command, args, {input: input, cwd: cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`)
    return result.stdout
}

/**
 * Run a script in a container
 * @param container
 * @param script
 */
function Exec(container: string, script: string): string {
    return Must('docker', ['exec', '-i', container, 'sh', '-s'], script)
}

/**
 * The image of a system running its init (systemd, OpenRC), with curl
 * @param name
 * @param dockerfile
 */
function Image(name: string, dockerfile: string): string {
    const tag: string = `lakutata-test-${name}`
    Must('docker', ['build', '-q', '-t', tag, '-'], dockerfile)
    return tag
}

/**
 * Wait for a command of a container to succeed
 * @param container
 * @param script
 */
async function Until(container: string, script: string): Promise<string> {
    let last: string = ''
    for (let attempt = 0; attempt < 60; attempt++) {
        const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-s'], {input: script, encoding: 'utf8'})
        if (result.status === 0) return result.stdout
        last = `${result.stdout}${result.stderr}`
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
    }
    throw new Error(`${script} did not succeed:\n${last}`)
}

describe('The installers of Linux', {skip: !DOCKER && 'LAKUTATA_DOCKER=1 runs them in containers'}, (): void => {

    let work: string
    let out: string
    let refused: string

    before((): void => {
        //Its real path: Docker Desktop shares the directories of macOS by them (/var is a link to /private/var)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-installer-')))
        out = path.join(work, 'out')
        const fixture: string = path.join(work, 'fixture')
        const file = (name: string, content: string): void => {
            mkdirSync(path.dirname(path.join(fixture, name)), {recursive: true})
            writeFileSync(path.join(fixture, name), content)
        }
        //The builder, installed from its package
        mkdirSync(fixture, {recursive: true})
        Must('npm', ['pack', '--silent', '--pack-destination', fixture], undefined, BUILDER)
        const tarball: string = readdirSync(fixture).find((name: string): boolean => name.endsWith('.tgz'))!
        //A native addon built when it is installed (node-gyp)
        file('addon/package.json', JSON.stringify({name: 'hello-addon', version: '1.0.0', main: 'index.js', gypfile: true, scripts: {install: 'node-gyp rebuild'}}))
        file('addon/binding.gyp', JSON.stringify({targets: [{target_name: 'addon', sources: ['addon.c']}]}))
        file('addon/addon.c', `#include <node_api.h>
static napi_value Arch(napi_env env, napi_callback_info info) {
    napi_value result;
#if defined(__aarch64__)
    napi_create_string_utf8(env, "arm64", NAPI_AUTO_LENGTH, &result);
#else
    napi_create_string_utf8(env, "x64", NAPI_AUTO_LENGTH, &result);
#endif
    return result;
}
NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "arch", NAPI_AUTO_LENGTH, Arch, NULL, &function);
    napi_set_named_property(env, exports, "arch", function);
    return exports;
}
`)
        file('addon/index.js', `module.exports = require(require('node:path').join(__dirname, 'build', 'Release', 'addon.node'))`)
        //A service answering what it runs with, and a command
        file('assets/hello.txt', 'Hello')
        file('build/index.js', `const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const addon = require('hello-addon')
const text = () => fs.readFileSync(path.join(globalThis[Symbol.for('lakutata.packaged')].resources(), 'texts', 'hello.txt'), 'utf8')
if (process.argv[2] === 'hello') {
    console.log(text() + ' ' + addon.arch())
    process.exit(0)
}
http.createServer((request, response) => response.end(JSON.stringify({greeting: process.env.GREETING, mode: process.env.MODE, user: os.userInfo().username, cwd: process.cwd(), text: text(), arch: addon.arch()}))).listen(Number(process.env.PORT))
process.on('SIGTERM', () => process.exit(0))
`)
        file('package.json', JSON.stringify({
            name: '@acme/hello', version: '1.0.0', description: 'Says hello', author: 'Acme <ops@acme.test>', license: 'MIT',
            main: 'build/index.js', bin: {hello: 'build/index.js'},
            dependencies: {'@lakutata/builder': `file:./${tarball}`, 'hello-addon': 'file:./addon'},
            lakutata: {
                resources: [{from: 'assets', to: 'texts'}],
                installer: {name: 'hello-service', service: {env: {GREETING: 'Hi', PORT: '18080'}}}
            }
        }))
        //The packages of the two versions (the upgrades), made on the systems of the glibc and of musl
        const build: string = `set -e
cp -R /fixture /w && cd /w
npm install --no-audit --no-fund >/dev/null 2>&1
for version in 1.0.0 1.0.1; do
    node -e "const p = require('/w/package.json'); p.version = process.argv[1]; require('fs').writeFileSync('/w/package.json', JSON.stringify(p))" $version
    node -e "import('@lakutata/builder').then(b => b.BuildInstaller({project: '/w', targets: process.argv.slice(1), outdir: '/out/' + require('/w/package.json').version}))" "$@"
done
`
        Must('docker', ['run', '--rm', '-i', '-v', `${fixture}:/fixture:ro`, '-v', `${out}:/out`, 'node:24-bookworm', 'sh', '-s', '--', 'deb', 'rpm', 'archlinux', 'tar.gz'], build)
        //On Alpine (musl), the executables of Node.js do not load native addons: the ones of Bun do
        const alpine: string = build.replace('npm install', `node -e "const p = require('/w/package.json'); p.lakutata.installer.runtime = 'bun'; p.devDependencies = {bun: '1.4.2'}; require('fs').writeFileSync('/w/package.json', JSON.stringify(p))"
npm install`)
        Must('docker', ['run', '--rm', '-i', '-v', `${fixture}:/fixture:ro`, '-v', `${out}:/out`, 'node:24-alpine', 'sh', '-s', '--', 'apk'], `apk add --no-cache python3 make g++ >/dev/null\n${alpine}`)
        refused = Must('docker', ['run', '--rm', '-i', '-v', `${fixture}:/fixture:ro`, 'node:24-alpine', 'sh', '-s'], `apk add --no-cache python3 make g++ >/dev/null
cp -R /fixture /w && cd /w && npm install --no-audit --no-fund >/dev/null 2>&1
node -e "import('@lakutata/builder').then(b => b.BuildInstaller({project: '/w', targets: ['apk']})).then(() => console.log('made'), error => console.log(error.message))"
`)
    })

    after((): void => {
        spawnSync('docker', ['rm', '-f', 'lakutata-installer-debian', 'lakutata-installer-fedora', 'lakutata-installer-alpine'])
        //Kept to look at them (LAKUTATA_KEEP=1)
        if (process.env.LAKUTATA_KEEP !== '1') rmSync(work, {recursive: true, force: true})
        else console.log(`The packages: ${out}`)
    })

    it('tells to make the executables with Bun on musl, where the ones of Node.js do not load native addons', (): void => {
        assert.match(refused, /The executables of Node\.js do not load native addons on musl \(Alpine\): make the executable with Bun/)
    })

    it('makes the packages of each system, named as they name them', (): void => {
        const arch: string = execFileSync('uname', ['-m']).toString().trim() === 'arm64' ? 'arm64' : 'amd64'
        const rpm: string = arch === 'arm64' ? 'aarch64' : 'x86_64'
        assert.deepStrictEqual(readdirSync(path.join(out, '1.0.0')).sort(), [
            `hello-service-1.0.0-1-${rpm}.pkg.tar.zst`,
            `hello-service-1.0.0-1.${rpm}.rpm`,
            `hello-service-1.0.0-linux-${arch}.tar.gz`,
            `hello-service-1.0.0-r0.${rpm}.apk`,
            `hello-service_1.0.0_${arch}.deb`
        ].sort())
        //The archive is the directory of the executable
        const listed: string = Must('tar', ['-tzf', path.join(out, '1.0.0', `hello-service-1.0.0-linux-${arch}.tar.gz`)])
        assert.match(listed, /hello-service-1\.0\.0-linux-\w+\/hello\n/)
        assert.match(listed, /\/resources\/texts\/hello\.txt/)
        assert.match(listed, /\/native\/.*addon\.node/)
    })

    for (const system of ['debian', 'fedora'] as const) {
        it(`installs on ${system} the program and its service (systemd), upgrades and removes them`, async (): Promise<void> => {
            const image: string = system === 'debian'
                ? Image('debian-systemd', 'FROM debian:12\nRUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv curl >/dev/null && rm -rf /var/lib/apt/lists/*\nCMD ["/sbin/init"]\n')
                : Image('fedora-systemd', 'FROM fedora:41\nRUN dnf install -y -q systemd curl >/dev/null && dnf clean all\nCMD ["/usr/sbin/init"]\n')
            const container: string = `lakutata-installer-${system}`
            spawnSync('docker', ['rm', '-f', container])
            Must('docker', ['run', '-d', '--name', container, '--privileged', '--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '-v', `${out}:/out:ro`, image])
            await Until(container, 'systemctl is-system-running --wait >/dev/null 2>&1 || systemctl is-system-running | grep -q degraded')
            const install = (version: string): string => system === 'debian'
                ? `apt-get install -y -qq /out/${version}/hello-service_${version}_*.deb >/dev/null`
                : `dnf install -y -q /out/${version}/hello-service-${version}-1.*.rpm >/dev/null`
            Exec(container, install('1.0.0'))
            //Started by the installation, as its user, in its directory, with its environment, its resources and its addon
            const answer = JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/'))
            assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: 'hello-service', cwd: '/var/lib/hello-service', text: 'Hello', arch: undefined})
            assert.match(answer.arch, /^(arm64|x64)$/)
            assert.strictEqual(Exec(container, 'systemctl is-enabled hello-service').trim(), 'enabled')
            //The program in the PATH
            assert.match(Exec(container, 'hello hello'), /^Hello (arm64|x64)\n$/)
            //The administrators change its environment
            Exec(container, `sed -i 's/^GREETING=.*/GREETING="Bonjour"/' /etc/hello-service/hello-service.env && systemctl restart hello-service`)
            assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
            //Upgraded, it runs again, its environment kept
            Exec(container, install('1.0.1'))
            assert.strictEqual(Exec(container, 'systemctl is-active hello-service').trim(), 'active')
            assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
            assert.match(Exec(container, system === 'debian' ? "dpkg-query -W -f='${Version}' hello-service" : "rpm -q --qf '%{VERSION}' hello-service"), /^1\.0\.1/)
            //Removed, it is stopped, its files removed
            Exec(container, system === 'debian' ? 'apt-get remove -y -qq hello-service >/dev/null' : 'dnf remove -y -q hello-service >/dev/null')
            assert.notStrictEqual(spawnSync('docker', ['exec', container, 'systemctl', 'is-active', 'hello-service'], {encoding: 'utf8'}).stdout.trim(), 'active')
            assert.strictEqual(Exec(container, 'ls /opt/hello-service /usr/bin/hello /usr/lib/systemd/system/hello-service.service 2>/dev/null | wc -l').trim(), '0')
            spawnSync('docker', ['rm', '-f', container])
        })
    }

    it('installs on Alpine the program and its service (OpenRC), upgrades and removes them', async (): Promise<void> => {
        const image: string = Image('alpine-openrc', 'FROM alpine:3.20\nRUN apk add --no-cache openrc curl >/dev/null && mkdir -p /run/openrc && touch /run/openrc/softlevel\nCMD ["sleep", "infinity"]\n')
        const container: string = 'lakutata-installer-alpine'
        spawnSync('docker', ['rm', '-f', container])
        //An init reaping the processes (OpenRC waits for its supervisor to end), as on the systems
        Must('docker', ['run', '-d', '--init', '--name', container, '-v', `${out}:/out:ro`, image])
        Exec(container, 'openrc default >/dev/null 2>&1 || true')
        Exec(container, 'apk add --allow-untrusted -q /out/1.0.0/hello-service-1.0.0-r0.*.apk')
        const answer = JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/'))
        assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: 'hello-service', cwd: '/var/lib/hello-service', text: 'Hello', arch: undefined})
        assert.match(Exec(container, 'hello hello'), /^Hello (arm64|x64)\n$/)
        Exec(container, `sed -i 's/^GREETING=.*/GREETING="Bonjour"/' /etc/hello-service/hello-service.env && rc-service hello-service restart >/dev/null 2>&1`)
        assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        Exec(container, 'apk add --allow-untrusted -q /out/1.0.1/hello-service-1.0.1-r0.*.apk')
        assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        Exec(container, 'apk del -q hello-service')
        assert.strictEqual(Exec(container, 'ls /opt/hello-service /usr/bin/hello /etc/init.d/hello-service 2>/dev/null | wc -l').trim(), '0')
        assert.notStrictEqual(spawnSync('docker', ['exec', container, 'curl', '-sf', 'http://127.0.0.1:18080/']).status, 0)
        spawnSync('docker', ['rm', '-f', container])
    })
})
