import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {WriteElectronFixture, WriteServiceFixture} from './support/Fixture.js'

/**
 * The installers are made and installed in containers (Docker): the packages of the systems of the glibc on Debian,
 * the ones of Alpine (musl) on Alpine; their services run by systemd (Debian, Fedora) and OpenRC (Alpine)
 */
const DOCKER: boolean = process.env.LAKUTATA_DOCKER === '1'

/**
 * The platform of the containers (LAKUTATA_DOCKER_PLATFORM: linux/amd64 on the Macs of Apple silicon, by Rosetta), the
 * one of the machine by default
 */
const PLATFORM: string | undefined = process.env.LAKUTATA_DOCKER_PLATFORM
const PLATFORM_ARGS: string[] = PLATFORM ? ['--platform', PLATFORM] : []

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
    const tag: string = `lakutata-test-${name}${PLATFORM ? `-${PLATFORM.replace(/\//g, '-')}` : ''}`
    Must('docker', ['build', ...PLATFORM_ARGS, '-q', '-t', tag, '-'], dockerfile)
    return tag
}

/**
 * Wait for a command of a container to succeed
 * @param container
 * @param script
 */
async function Until(container: string, script: string): Promise<string> {
    let last: string = ''
    //Longer on the platforms emulated (Rosetta)
    for (let attempt = 0; attempt < (PLATFORM ? 240 : 60); attempt++) {
        const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-s'], {input: script, encoding: 'utf8'})
        if (result.status === 0) return result.stdout
        last = `${result.stdout}${result.stderr}`
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
    }
    //The state of the service, and its log
    const service = spawnSync('docker', ['exec', '-i', container, 'sh', '-s'], {
        input: '(systemctl status hello-service --no-pager; journalctl -u hello-service --no-pager | tail -30) 2>&1 || (rc-service hello-service status; tail -30 /var/log/hello-service.log) 2>&1',
        encoding: 'utf8'
    })
    throw new Error(`${script} did not succeed:\n${last}\n${service.stdout}${service.stderr}`)
}

/**
 * What the scripts of the application were run with (their log)
 * @param container
 */
function Hooks(container: string): string[] {
    return Exec(container, 'cat /tmp/hello-hooks.log 2>/dev/null || true').split('\n').filter(Boolean)
}

/**
 * The lines the scripts of the application write: the moment, what the installer does, whether the files are installed
 */
const INSTALLED: string[] = ['preinstall install nofiles /opt/hello-service', 'postinstall install files /opt/hello-service']
const UPGRADED: string[] = ['preinstall upgrade files /opt/hello-service', 'postinstall upgrade files /opt/hello-service']
const REMOVED: string[] = ['preremove remove files /opt/hello-service', 'postremove remove nofiles /opt/hello-service']

describe('The installers of Linux', {skip: !DOCKER && 'LAKUTATA_DOCKER=1 runs them in containers'}, (): void => {

    let work: string
    let out: string
    let refused: string

    before((): void => {
        //Its real path: Docker Desktop shares the directories of macOS by them (/var is a link to /private/var)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-installer-')))
        out = path.join(work, 'out')
        const fixture: string = path.join(work, 'fixture')
        //The builder, installed from its package
        mkdirSync(fixture, {recursive: true})
        Must('npm', ['pack', '--silent', '--pack-destination', fixture], undefined, BUILDER)
        const tarball: string = readdirSync(fixture).find((name: string): boolean => name.endsWith('.tgz'))!
        WriteServiceFixture(fixture, {'@lakutata/builder': `file:./${tarball}`})
        //The packages of the two versions (the upgrades), made on the systems of the glibc and of musl
        const build: string = `set -e
cp -R /fixture /w && cd /w
npm install --no-audit --no-fund >/dev/null 2>&1
for version in 1.0.0 1.0.1; do
    node -e "const p = require('/w/package.json'); p.version = process.argv[1]; require('fs').writeFileSync('/w/package.json', JSON.stringify(p))" $version
    node -e "import('@lakutata/builder').then(b => b.BuildInstaller({project: '/w', targets: process.argv.slice(1), outdir: '/out/' + require('/w/package.json').version}))" "$@"
done
`
        Must('docker', ['run', ...PLATFORM_ARGS, '--rm', '-i', '-v', `${fixture}:/fixture:ro`, '-v', `${out}:/out`, 'node:24-bookworm', 'sh', '-s', '--', 'deb', 'rpm', 'archlinux', 'tar.gz'], build)
        //On Alpine (musl), the executables of Node.js do not load native addons: the ones of Bun do
        const alpine: string = build.replace('npm install', `node -e "const p = require('/w/package.json'); p.lakutata.installer.runtime = 'bun'; p.devDependencies = {bun: '1.4.2'}; require('fs').writeFileSync('/w/package.json', JSON.stringify(p))"
npm install`)
        Must('docker', ['run', ...PLATFORM_ARGS, '--rm', '-i', '-v', `${fixture}:/fixture:ro`, '-v', `${out}:/out`, 'node:24-alpine', 'sh', '-s', '--', 'apk'], `apk add --no-cache python3 make g++ >/dev/null\n${alpine}`)
        //The packages of the Electron application (electron-builder), its packages of fpm made by the fpm of the system
        const desk: string = path.join(work, 'desk')
        const require = createRequire(import.meta.url)
        WriteElectronFixture(desk, {electron: require('electron/package.json').version, builder: require('electron-builder/package.json').version}, {'@lakutata/builder': `file:./${tarball}`})
        cpSync(path.join(fixture, tarball), path.join(desk, tarball))
        Must('docker', ['run', ...PLATFORM_ARGS, '--rm', '-i', '-v', `${desk}:/desk:ro`, '-v', `${out}:/out`, 'node:24-bookworm', 'sh', '-s'], `set -e
apt-get update -qq && apt-get install -y -qq --no-install-recommends ruby ruby-dev rpm build-essential >/dev/null 2>&1
gem install fpm --no-document >/dev/null 2>&1
export USE_SYSTEM_FPM=true
cp -R /desk /w && cd /w
npm install --no-audit --no-fund >/dev/null 2>&1
for version in 1.0.0 1.0.1; do
    node -e "const p = require('/w/package.json'); p.version = process.argv[1]; require('fs').writeFileSync('/w/package.json', JSON.stringify(p))" $version
    node -e "import('@lakutata/builder').then(b => b.BuildInstaller({project: '/w', outdir: '/out/desk/' + require('/w/package.json').version}))" >/dev/null
done
`)
        refused = Must('docker', ['run', ...PLATFORM_ARGS, '--rm', '-i', '-v', `${fixture}:/fixture:ro`, 'node:24-alpine', 'sh', '-s'], `apk add --no-cache python3 make g++ >/dev/null
cp -R /fixture /w && cd /w && npm install --no-audit --no-fund >/dev/null 2>&1
node -e "import('@lakutata/builder').then(b => b.BuildInstaller({project: '/w', targets: ['apk']})).then(() => console.log('made'), error => console.log(error.message))"
`)
    })

    after((): void => {
        spawnSync('docker', ['rm', '-f', 'lakutata-installer-debian', 'lakutata-installer-fedora', 'lakutata-installer-alpine', 'lakutata-installer-archlinux', 'lakutata-installer-desk-debian', 'lakutata-installer-desk-fedora'])
        //Kept to look at them (LAKUTATA_KEEP=1)
        if (process.env.LAKUTATA_KEEP !== '1') rmSync(work, {recursive: true, force: true})
        else console.log(`The packages: ${out}`)
    })

    it('tells to make the executables with Bun on musl, where the ones of Node.js do not load native addons', (): void => {
        assert.match(refused, /The executables of Node\.js do not load native addons on musl \(Alpine\): make the executable with Bun/)
    })

    it('makes the packages of each system, named as they name them', (): void => {
        const arch: string = (PLATFORM ? PLATFORM.endsWith('arm64') : execFileSync('uname', ['-m']).toString().trim() === 'arm64') ? 'arm64' : 'amd64'
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
        //The systemd of Fedora does not run its services on the platforms emulated (Rosetta): its bus is not connected
        it(`installs on ${system} the program and its service (systemd), upgrades and removes them`, {skip: system === 'fedora' && PLATFORM === 'linux/amd64' && process.arch === 'arm64' && 'the systemd of Fedora does not run under Rosetta'}, async (): Promise<void> => {
            const image: string = system === 'debian'
                ? Image('debian-systemd', 'FROM debian:12\nRUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv curl >/dev/null && rm -rf /var/lib/apt/lists/*\nCMD ["/sbin/init"]\n')
                : Image('fedora-systemd', 'FROM fedora:41\nRUN dnf install -y -q systemd curl >/dev/null && dnf clean all\nCMD ["/usr/sbin/init"]\n')
            const container: string = `lakutata-installer-${system}`
            spawnSync('docker', ['rm', '-f', container])
            Must('docker', ['run', ...PLATFORM_ARGS, '-d', '--name', container, '--privileged', '--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '-v', `${out}:/out:ro`, image])
            await Until(container, 'systemctl is-system-running --wait >/dev/null 2>&1 || systemctl is-system-running | grep -q degraded')
            const install = (version: string): string => system === 'debian'
                ? `apt-get install -y -qq /out/${version}/hello-service_${version}_*.deb >/dev/null`
                : `dnf install -y -q /out/${version}/hello-service-${version}-1.*.rpm >/dev/null`
            Exec(container, install('1.0.0'))
            //The scripts of the application: the postinstall one of rpm replaces the one of Linux, the native one of deb is
            //given the arguments of dpkg
            const own = (lines: string[]): string[] => system === 'debian'
                ? [...lines, ...lines.some((line: string): boolean => line.startsWith('postinstall')) ? ['native-postinstall configure'] : []]
                : lines.map((line: string): string => line.replace(/^postinstall/, 'rpm-postinstall'))
            assert.deepStrictEqual(Hooks(container), own(INSTALLED))
            //Started by the installation, as its user, in its directory, with its environment, its resources and its addon
            const answer = JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/'))
            assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: 'hello-service', cwd: '/var/lib/hello-service', text: 'Hello', arch: undefined})
            assert.match(answer.arch, /^(arm64|x64)$/)
            assert.strictEqual(Exec(container, 'systemctl is-enabled hello-service').trim(), 'enabled')
            //Its resources named as the chunks of Turbopack
            assert.strictEqual(Exec(container, "cat '/opt/hello-service/resources/texts/[root-of-the-server]__chunk.js'"), 'chunk')
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
            //The removal of the version replaced runs no script of the application
            assert.deepStrictEqual(Hooks(container), [...own(INSTALLED), ...own(UPGRADED)])
            //Removed, it is stopped, its files removed
            Exec(container, system === 'debian' ? 'apt-get remove -y -qq hello-service >/dev/null' : 'dnf remove -y -q hello-service >/dev/null')
            assert.deepStrictEqual(Hooks(container), [...own(INSTALLED), ...own(UPGRADED), ...REMOVED])
            assert.notStrictEqual(spawnSync('docker', ['exec', container, 'systemctl', 'is-active', 'hello-service'], {encoding: 'utf8'}).stdout.trim(), 'active')
            assert.strictEqual(Exec(container, 'ls /opt/hello-service /usr/bin/hello /usr/lib/systemd/system/hello-service.service 2>/dev/null | wc -l').trim(), '0')
            spawnSync('docker', ['rm', '-f', container])
        })
    }

    for (const system of ['debian', 'fedora'] as const) {
        it(`installs on ${system} the Electron application (electron-builder), upgrades and removes it, running its scripts`, (): void => {
            const container: string = `lakutata-installer-desk-${system}`
            spawnSync('docker', ['rm', '-f', container])
            Must('docker', ['run', ...PLATFORM_ARGS, '-d', '--name', container, '-v', `${out}:/out:ro`, system === 'debian' ? 'debian:12' : 'fedora:41', 'sleep', 'infinity'])
            const install = (version: string): string => Exec(container, system === 'debian'
                ? `apt-get update -qq >/dev/null && apt-get install -y -qq /out/desk/${version}/hello-desk_${version}_*.deb >/dev/null 2>&1`
                : `dnf install -y -q /out/desk/${version}/hello-desk-${version}.*.rpm >/dev/null 2>&1`)
            const hooks = (): string[] => Exec(container, 'cat /tmp/hello-desk-hooks.log 2>/dev/null || true').split('\n').filter(Boolean)
            //Its ${...} are the ones of the script, not the ones of the templates of electron-builder
            const line = (hook: string, action: string, files: boolean): string => `${hook} ${action} ${files ? 'files' : 'nofiles'} /opt/Hello Desk kept`
            install('1.0.0')
            assert.deepStrictEqual(hooks(), [line('preinstall', 'install', false), line('postinstall', 'install', true)])
            //What the script of electron-builder does: the program in the PATH, the sandbox of Chromium
            assert.match(Exec(container, 'readlink -f /usr/bin/hello-desk'), /^\/opt\/Hello Desk\/hello-desk\n$/)
            assert.match(Exec(container, 'stat -c %a "/opt/Hello Desk/chrome-sandbox"'), /^(4755|755)\n$/)
            assert.strictEqual(Exec(container, 'cat "/opt/Hello Desk/resources/main.resources/texts/hello.txt"'), 'Hello')
            install('1.0.1')
            assert.deepStrictEqual(hooks(), [line('preinstall', 'install', false), line('postinstall', 'install', true), line('preinstall', 'upgrade', true), line('postinstall', 'upgrade', true)])
            Exec(container, system === 'debian' ? 'apt-get remove -y -qq hello-desk >/dev/null 2>&1' : 'dnf remove -y -q hello-desk >/dev/null 2>&1')
            assert.deepStrictEqual(hooks(), [line('preinstall', 'install', false), line('postinstall', 'install', true), line('preinstall', 'upgrade', true), line('postinstall', 'upgrade', true), line('preremove', 'remove', true), line('postremove', 'remove', false)])
            assert.strictEqual(Exec(container, 'ls /usr/bin/hello-desk 2>/dev/null | wc -l').trim(), '0')
            spawnSync('docker', ['rm', '-f', container])
        })
    }

    //The images of Arch Linux are the ones of x64 (amd64): the containers of linux/amd64, on Apple silicon by Rosetta
    it('installs on Arch Linux the program, upgrades and removes it, running the scripts of the application', {skip: (PLATFORM ? PLATFORM !== 'linux/amd64' : process.arch !== 'x64') && 'Arch Linux is installed on amd64 (LAKUTATA_DOCKER_PLATFORM=linux/amd64)'}, (): void => {
        const container: string = 'lakutata-installer-archlinux'
        spawnSync('docker', ['rm', '-f', container])
        //Its service is not run (no systemd): its scripts are, its user created
        Must('docker', ['run', ...PLATFORM_ARGS, '-d', '--name', container, '-v', `${out}:/out:ro`, 'archlinux:latest', 'sleep', 'infinity'])
        const install = (version: string): string => Exec(container, `pacman -U --noconfirm /out/${version}/hello-service-${version}-1-x86_64.pkg.tar.zst >/dev/null`)
        install('1.0.0')
        assert.deepStrictEqual(Hooks(container), INSTALLED)
        assert.match(Exec(container, 'hello hello'), /^Hello x64\n$/)
        assert.strictEqual(Exec(container, 'id -u hello-service >/dev/null && echo created').trim(), 'created')
        //The upgrades of pacman run their own scripts, which run the ones of the installation of the application
        install('1.0.1')
        assert.deepStrictEqual(Hooks(container), [...INSTALLED, ...UPGRADED])
        Exec(container, 'pacman -R --noconfirm hello-service >/dev/null')
        assert.deepStrictEqual(Hooks(container), [...INSTALLED, ...UPGRADED, ...REMOVED])
        assert.strictEqual(Exec(container, 'ls /opt/hello-service /usr/bin/hello 2>/dev/null | wc -l').trim(), '0')
        spawnSync('docker', ['rm', '-f', container])
    })

    it('installs on Alpine the program and its service (OpenRC), upgrades and removes them', async (): Promise<void> => {
        const image: string = Image('alpine-openrc', 'FROM alpine:3.20\nRUN apk add --no-cache openrc curl >/dev/null && mkdir -p /run/openrc && touch /run/openrc/softlevel\nCMD ["sleep", "infinity"]\n')
        const container: string = 'lakutata-installer-alpine'
        spawnSync('docker', ['rm', '-f', container])
        //An init reaping the processes (OpenRC waits for its supervisor to end), as on the systems
        Must('docker', ['run', ...PLATFORM_ARGS, '-d', '--init', '--name', container, '-v', `${out}:/out:ro`, image])
        Exec(container, 'openrc default >/dev/null 2>&1 || true')
        Exec(container, 'apk add --allow-untrusted -q /out/1.0.0/hello-service-1.0.0-r0.*.apk')
        assert.deepStrictEqual(Hooks(container), INSTALLED)
        const answer = JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/'))
        assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: 'hello-service', cwd: '/var/lib/hello-service', text: 'Hello', arch: undefined})
        assert.match(Exec(container, 'hello hello'), /^Hello (arm64|x64)\n$/)
        assert.strictEqual(Exec(container, "cat '/opt/hello-service/resources/texts/[root-of-the-server]__chunk.js'"), 'chunk')
        Exec(container, `sed -i 's/^GREETING=.*/GREETING="Bonjour"/' /etc/hello-service/hello-service.env && rc-service hello-service restart >/dev/null 2>&1`)
        assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        Exec(container, 'apk add --allow-untrusted -q /out/1.0.1/hello-service-1.0.1-r0.*.apk')
        assert.strictEqual(JSON.parse(await Until(container, 'curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        //The upgrades of apk run their own scripts, which run the ones of the installation of the application
        assert.deepStrictEqual(Hooks(container), [...INSTALLED, ...UPGRADED])
        Exec(container, 'apk del -q hello-service')
        assert.deepStrictEqual(Hooks(container), [...INSTALLED, ...UPGRADED, ...REMOVED])
        assert.strictEqual(Exec(container, 'ls /opt/hello-service /usr/bin/hello /etc/init.d/hello-service 2>/dev/null | wc -l').trim(), '0')
        assert.notStrictEqual(spawnSync('docker', ['exec', container, 'curl', '-sf', 'http://127.0.0.1:18080/']).status, 0)
        spawnSync('docker', ['rm', '-f', container])
    })
})
