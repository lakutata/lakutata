import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, spawn, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {BuildInstaller} from '../index.js'
import {WriteElectronFixture, WriteServiceFixture} from './support/Fixture.js'

/**
 * The installers of macOS are installed in a virtual machine of macOS (tart): their installation runs as root, their
 * service is loaded by launchd
 */
const TART: string = process.env.LAKUTATA_TART_BIN ?? [path.join(homedir(), 'Applications', 'tart.app', 'Contents', 'MacOS', 'tart')].find(existsSync) ?? 'tart'

/**
 * The image of the virtual machine (its user admin runs sudo without password)
 */
const IMAGE: string = process.env.LAKUTATA_TART_IMAGE ?? 'ghcr.io/cirruslabs/macos-sequoia-base:latest'

const VM: string = 'lakutata-installer-mac'

/**
 * Whether node runs by Rosetta (the node of Intel on Apple silicon): its processes run the universal programs as the
 * ones of Intel, tart (and the toolchain) are run natively
 */
const TRANSLATED: boolean = process.platform === 'darwin' && execFileSync('sysctl', ['-in', 'sysctl.proc_translated']).toString().trim() === '1'

/**
 * The command running tart with its arguments, natively
 * @param args
 */
function Tart(args: string[]): [string, string[]] {
    return TRANSLATED ? ['arch', ['-arm64', TART, ...args]] : [TART, args]
}

/**
 * Run a command in the virtual machine, its output given back; it must succeed
 * @param script
 */
function Exec(script: string): string {
    const result = spawnSync(...Tart(['exec', VM, 'sh', '-c', script]), {encoding: 'utf8'})
    if (result.status !== 0) throw new Error(`${script} failed (${result.status}):\n${result.stdout}${result.stderr}`)
    return result.stdout
}

/**
 * Wait for a command of the virtual machine to succeed
 * @param script
 */
async function Until(script: string): Promise<string> {
    let last: string = ''
    for (let attempt = 0; attempt < 120; attempt++) {
        const result = spawnSync(...Tart(['exec', VM, 'sh', '-c', script]), {encoding: 'utf8'})
        if (result.status === 0) return result.stdout
        last = `${result.stdout}${result.stderr}`
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1000))
    }
    throw new Error(`${script} did not succeed:\n${last}`)
}

describe('The installers of macOS', {skip: (process.platform !== 'darwin' || process.env.LAKUTATA_TART !== '1') && 'LAKUTATA_TART=1 installs them in a virtual machine of macOS (tart)'}, (): void => {

    let work: string
    let out: string

    before(async (): Promise<void> => {
        //Its real path: shared with the virtual machine
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-installer-mac-')))
        out = path.join(work, 'out')
        const fixture: string = path.join(work, 'fixture')
        WriteServiceFixture(fixture)
        //The addon built for the architecture of the node running the tests: for Intel on Apple silicon (the node of
        //Intel run by Rosetta), cross-compiled by the native toolchain (the processes of Rosetta run the universal ones
        //of Intel, which the tools of Apple silicon do not load)
        execFileSync(TRANSLATED ? 'arch' : 'npm', [...TRANSLATED ? ['-arm64', 'npm'] : [], 'install', '--no-audit', '--no-fund'], {cwd: fixture, stdio: 'ignore', env: {...process.env, npm_config_arch: process.arch}})
        //The packages of the two versions (the upgrades)
        for (const version of ['1.0.0', '1.0.1']) {
            const manifest = JSON.parse(readFileSync(path.join(fixture, 'package.json'), 'utf8'))
            writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({...manifest, version: version}))
            mkdirSync(path.join(out, version), {recursive: true})
            await BuildInstaller({project: fixture, targets: ['pkg'], outdir: path.join(out, version)})
        }
        //The packages of the two versions of the Electron application (electron-builder), the Electron of Apple silicon
        if (!TRANSLATED) {
            const desk: string = path.join(work, 'desk')
            const require = createRequire(import.meta.url)
            WriteElectronFixture(desk, {electron: require('electron/package.json').version, builder: require('electron-builder/package.json').version})
            execFileSync('npm', ['install', '--no-audit', '--no-fund'], {cwd: desk, stdio: 'ignore'})
            for (const version of ['1.0.0', '1.0.1']) {
                const manifest = JSON.parse(readFileSync(path.join(desk, 'package.json'), 'utf8'))
                writeFileSync(path.join(desk, 'package.json'), JSON.stringify({...manifest, version: version}))
                await BuildInstaller({project: desk, outdir: path.join(out, 'desk', version)})
            }
        }
        //A virtual machine of its own, the packages shared with it
        spawnSync(...Tart(['delete', VM]))
        execFileSync(...Tart(['clone', IMAGE, VM]))
        spawn(...Tart(['run', VM, '--no-graphics', `--dir=out:${out}:ro`]), {stdio: 'ignore', detached: true}).unref()
        await Until('true')
        //The executables of Intel run by Rosetta on the virtual machine of Apple silicon
        if (process.arch === 'x64' && Exec('uname -m').trim() === 'arm64') Exec('sudo softwareupdate --install-rosetta --agree-to-license >/dev/null 2>&1')
    })

    after((): void => {
        spawnSync(...Tart(['stop', VM]))
        spawnSync(...Tart(['delete', VM]))
        rmSync(work, {recursive: true, force: true})
    })

    it('installs the program and its service (launchd), upgrades and removes them', async (): Promise<void> => {
        const shared: string = '/Volumes/My Shared Files/out'
        const install = (version: string): string => Exec(`sudo installer -pkg "${shared}/${version}/hello-service-${version}-${process.arch}.pkg" -target /`)
        install('1.0.0')
        //The scripts of the application: what the installer does, whether the files are installed, their directory
        const hooks = (): string[] => Exec('cat /tmp/hello-hooks.log 2>/dev/null || true').split('\n').filter(Boolean)
        const installed: string[] = ['preinstall install nofiles /usr/local/lib/hello-service', 'postinstall install files /usr/local/lib/hello-service']
        const upgraded: string[] = ['preinstall upgrade files /usr/local/lib/hello-service', 'postinstall upgrade files /usr/local/lib/hello-service']
        assert.deepStrictEqual(hooks(), installed)
        //Started by the installation, as its hidden user, in its directory, with its environment, its resources and its addon
        const answer = JSON.parse(await Until('curl -sf http://127.0.0.1:18080/'))
        assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: '_hello-service', cwd: '/usr/local/var/lib/hello-service', text: 'Hello', arch: undefined})
        assert.strictEqual(answer.arch, process.arch)
        assert.match(Exec('dscl . -read /Users/_hello-service IsHidden').trim(), /IsHidden: 1$/)
        assert.strictEqual(Exec("cat '/usr/local/lib/hello-service/resources/texts/[root-of-the-server]__chunk.js'"), 'chunk')
        //The program in the PATH
        assert.strictEqual(Exec('/usr/local/bin/hello hello').trim(), `Hello ${process.arch}`)
        //The administrators change its environment
        Exec(`sudo sed -i '' 's/^GREETING=.*/GREETING="Bonjour"/' /usr/local/etc/hello-service/hello-service.env && sudo launchctl kickstart -k system/test.acme.hello`)
        assert.strictEqual(JSON.parse(await Until('curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        //Upgraded, it runs again, its environment kept
        install('1.0.1')
        assert.strictEqual(JSON.parse(await Until('curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        assert.match(Exec('pkgutil --pkg-info test.acme.hello'), /version: 1\.0\.1/)
        assert.deepStrictEqual(hooks(), [...installed, ...upgraded])
        //Removed, it is stopped, its files removed
        Exec('sudo /usr/local/lib/hello-service/uninstall')
        assert.deepStrictEqual(hooks(), [...installed, ...upgraded, 'preremove remove files /usr/local/lib/hello-service', 'postremove remove nofiles /usr/local/lib/hello-service'])
        assert.notStrictEqual(spawnSync(...Tart(['exec', VM, 'curl', '-sf', 'http://127.0.0.1:18080/'])).status, 0)
        assert.strictEqual(Exec('ls /usr/local/lib/hello-service /usr/local/bin/hello /Library/LaunchDaemons/test.acme.hello.plist 2>/dev/null | wc -l').trim(), '0')
        assert.notStrictEqual(spawnSync(...Tart(['exec', VM, 'pkgutil', '--pkg-info', 'test.acme.hello'])).status, 0)
    })

    it('installs the Electron application by its pkg package (electron-builder) and upgrades it, running its scripts', {skip: TRANSLATED && 'the Electron of Apple silicon'}, (): void => {
        const shared: string = '/Volumes/My Shared Files/out/desk'
        const install = (version: string): string => Exec(`sudo installer -pkg "${shared}/${version}/$(ls "${shared}/${version}" | grep '\\.pkg$')" -target /`)
        const hooks = (): string[] => Exec('cat /tmp/hello-desk-hooks.log 2>/dev/null || true').split('\n').filter(Boolean)
        const line = (hook: string, action: string, files: boolean): string => `${hook} ${action} ${files ? 'files' : 'nofiles'} /Applications/Hello Desk.app kept`
        install('1.0.0')
        //Its resources next to its archive; the ${...} of the scripts are theirs
        assert.strictEqual(Exec('cat "/Applications/Hello Desk.app/Contents/Resources/main.resources/texts/hello.txt"'), 'Hello')
        assert.deepStrictEqual(hooks(), [line('preinstall', 'install', false), line('postinstall', 'install', true)])
        install('1.0.1')
        assert.deepStrictEqual(hooks(), [line('preinstall', 'install', false), line('postinstall', 'install', true), line('preinstall', 'upgrade', true), line('postinstall', 'upgrade', true)])
        assert.match(Exec('defaults read "/Applications/Hello Desk.app/Contents/Info" CFBundleShortVersionString'), /^1\.0\.1/)
    })
})
