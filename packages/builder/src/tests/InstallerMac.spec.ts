import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, spawn, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {BuildInstaller} from '../index.js'
import {WriteServiceFixture} from './support/Fixture.js'

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
 * Run a command in the virtual machine, its output given back; it must succeed
 * @param script
 */
function Exec(script: string): string {
    const result = spawnSync(TART, ['exec', VM, 'sh', '-c', script], {encoding: 'utf8'})
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
        const result = spawnSync(TART, ['exec', VM, 'sh', '-c', script], {encoding: 'utf8'})
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
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], {cwd: fixture, stdio: 'ignore'})
        //The packages of the two versions (the upgrades)
        for (const version of ['1.0.0', '1.0.1']) {
            const manifest = JSON.parse(readFileSync(path.join(fixture, 'package.json'), 'utf8'))
            writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({...manifest, version: version}))
            mkdirSync(path.join(out, version), {recursive: true})
            await BuildInstaller({project: fixture, targets: ['pkg'], outdir: path.join(out, version)})
        }
        //A virtual machine of its own, the packages shared with it
        spawnSync(TART, ['delete', VM])
        execFileSync(TART, ['clone', IMAGE, VM])
        spawn(TART, ['run', VM, '--no-graphics', `--dir=out:${out}:ro`], {stdio: 'ignore', detached: true}).unref()
        await Until('true')
    })

    after((): void => {
        spawnSync(TART, ['stop', VM])
        spawnSync(TART, ['delete', VM])
        rmSync(work, {recursive: true, force: true})
    })

    it('installs the program and its service (launchd), upgrades and removes them', async (): Promise<void> => {
        const shared: string = '/Volumes/My Shared Files/out'
        const install = (version: string): string => Exec(`sudo installer -pkg "${shared}/${version}/hello-service-${version}-${process.arch}.pkg" -target /`)
        install('1.0.0')
        //Started by the installation, as its hidden user, in its directory, with its environment, its resources and its addon
        const answer = JSON.parse(await Until('curl -sf http://127.0.0.1:18080/'))
        assert.deepStrictEqual({...answer, arch: undefined}, {greeting: 'Hi', mode: 'production', user: '_hello-service', cwd: '/usr/local/var/lib/hello-service', text: 'Hello', arch: undefined})
        assert.strictEqual(answer.arch, process.arch)
        assert.strictEqual(Exec('dscl . -read /Users/_hello-service IsHidden').trim(), 'IsHidden: 1')
        //The program in the PATH
        assert.strictEqual(Exec('/usr/local/bin/hello hello').trim(), `Hello ${process.arch}`)
        //The administrators change its environment
        Exec(`sudo sed -i '' 's/^GREETING=.*/GREETING="Bonjour"/' /usr/local/etc/hello-service/hello-service.env && sudo launchctl kickstart -k system/test.acme.hello`)
        assert.strictEqual(JSON.parse(await Until('curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        //Upgraded, it runs again, its environment kept
        install('1.0.1')
        assert.strictEqual(JSON.parse(await Until('curl -sf http://127.0.0.1:18080/')).greeting, 'Bonjour')
        assert.match(Exec('pkgutil --pkg-info test.acme.hello'), /version: 1\.0\.1/)
        //Removed, it is stopped, its files removed
        Exec('sudo /usr/local/lib/hello-service/uninstall')
        assert.notStrictEqual(spawnSync(TART, ['exec', VM, 'curl', '-sf', 'http://127.0.0.1:18080/']).status, 0)
        assert.strictEqual(Exec('ls /usr/local/lib/hello-service /usr/local/bin/hello /Library/LaunchDaemons/test.acme.hello.plist 2>/dev/null | wc -l').trim(), '0')
        assert.notStrictEqual(spawnSync(TART, ['exec', VM, 'pkgutil', '--pkg-info', 'test.acme.hello']).status, 0)
    })
})
