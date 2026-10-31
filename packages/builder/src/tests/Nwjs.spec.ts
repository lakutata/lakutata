import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {downloadNwjs, nwjsPlatform, nwjsRelease, nwjsReleases, stageNwjsApp, type NwjsRelease, type NwjsStage} from '../index.js'

/**
 * The list of nwjs.io, three releases: the latest, the last one of Windows 7, and one embedding Node.js 18.5
 */
const VERSIONS = {
    latest: 'v0.119.2',
    versions: [
        {version: 'v0.69.1', date: '2022/09/29', files: ['win-x64', 'osx-x64', 'linux-x64'], components: {node: '18.5.0', chromium: '106.0.5249.91'}},
        {version: 'v0.119.2', date: '2026/10/22', files: ['win-x64', 'win-ia32', 'win-arm64', 'osx-x64', 'osx-arm64', 'linux-x64', 'linux-arm64'], components: {node: '26.12.1', chromium: '156.0.8078.48'}},
        {version: 'v0.72.0', date: '2023/01/13', files: ['win-x64', 'win-ia32', 'osx-x64', 'linux-x64', 'linux-ia32'], components: {node: '19.3.0', chromium: '109.0.5414.87'}}
    ]
}

describe('The runtimes of NW.js', (): void => {

    let work: string
    let server: Server
    //The files the server gives (their paths), the requests it answered
    const files: Map<string, Buffer> = new Map()
    const requests: string[] = []
    const environment: Record<string, string | undefined> = {}

    /**
     * The archive of a fake runtime of NW.js for the machine, as dl.nwjs.io names it: its executable a script
     * @param version
     */
    function fakeRuntime(version: string): { archive: string, content: Buffer } {
        const release: NwjsRelease = {version: version, date: '', node: '', chromium: '', platforms: VERSIONS.versions.find((item): boolean => item.version === `v${version}`)!.files}
        const platform: string = nwjsPlatform(release)
        const name: string = `nwjs-sdk-v${version}-${platform}`
        const source: string = mkdtempSync(path.join(work, 'archive-'))
        const executable: string[] = platform.startsWith('win-') ? ['nw.exe'] : platform.startsWith('osx-') ? ['nwjs.app', 'Contents', 'MacOS', 'nwjs'] : ['nw']
        mkdirSync(path.join(source, name, ...executable.slice(0, -1)), {recursive: true})
        writeFileSync(path.join(source, name, ...executable), '#!/bin/sh\necho nw\n', {mode: 0o755})
        writeFileSync(path.join(source, name, 'credits.html'), 'credits')
        const archive: string = `${name}.${platform.startsWith('linux-') ? 'tar.gz' : 'zip'}`
        if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', name, path.join(source, archive)], {cwd: source})
        else execFileSync('tar', platform.startsWith('linux-') ? ['-czf', archive, name] : ['-a', '-cf', archive, name], {cwd: source})
        return {archive: archive, content: readFileSync(path.join(source, archive))}
    }

    before(async (): Promise<void> => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-nwjs-'))
        files.set('/versions.json', Buffer.from(JSON.stringify(VERSIONS)))
        for (const version of ['0.72.0', '0.119.2']) {
            const {archive, content} = fakeRuntime(version)
            files.set(`/v${version}/${archive}`, content)
            //The checksum of 0.119.2 is wrong: its archive is refused
            const sum: string = version === '0.119.2' ? '0'.repeat(64) : createHash('sha256').update(content).digest('hex')
            files.set(`/v${version}/SHASUMS256.txt`, Buffer.from(`${'1'.repeat(64)}  nwjs-other.zip\n${sum}  ${archive}\n`))
        }
        server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            requests.push(request.url!)
            const content: Buffer | undefined = files.get(request.url!)
            response.writeHead(content ? 200 : 404).end(content)
        })
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        const url: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        for (const [name, value] of Object.entries({LAKUTATA_CACHE_DIR: path.join(work, 'cache'), LAKUTATA_NWJS_VERSIONS: `${url}/versions.json`, LAKUTATA_NWJS_MIRROR: `${url}/`})) {
            environment[name] = process.env[name]
            process.env[name] = value
        }
    })

    after(async (): Promise<void> => {
        for (const [name, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
        }
        await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
        rmSync(work, {recursive: true, force: true})
    })

    it('lists the releases newest first, read once a day', async (): Promise<void> => {
        assert.deepStrictEqual((await nwjsReleases()).map((release: NwjsRelease): string => release.version), ['0.119.2', '0.72.0', '0.69.1'])
        await nwjsReleases()
        assert.strictEqual(requests.filter((url: string): boolean => url === '/versions.json').length, 1)
    })

    it('gives a release by its version or its alias, refused when its Node.js is older than 18.10', async (): Promise<void> => {
        assert.strictEqual((await nwjsRelease('latest')).version, '0.119.2')
        const win7: NwjsRelease = await nwjsRelease('win7')
        assert.deepStrictEqual([win7.version, win7.node, win7.chromium], ['0.72.0', '19.3.0', '109.0.5414.87'])
        assert.strictEqual((await nwjsRelease('v0.72.0')).version, '0.72.0')
        await assert.rejects(nwjsRelease('0.69.1'), /embeds Node\.js 18\.5\.0: lakutata runs on Node\.js 18\.10\.0 or later/)
        await assert.rejects(nwjsRelease('0.50.0'), /0\.50\.0 is not a release of NW\.js \(the latest: 0\.119\.2\)/)
    })

    it('names the build of a system, the x64 one on a Mac with Apple silicon before osx-arm64', async (): Promise<void> => {
        const win7: NwjsRelease = await nwjsRelease('win7')
        assert.strictEqual(nwjsPlatform(win7, 'darwin', 'arm64'), 'osx-x64')
        assert.strictEqual(nwjsPlatform(win7, 'win32', 'ia32'), 'win-ia32')
        assert.strictEqual(nwjsPlatform(await nwjsRelease('latest'), 'darwin', 'arm64'), 'osx-arm64')
        assert.throws((): string => nwjsPlatform(win7, 'linux', 'arm64'), /NW\.js 0\.72\.0 has no build for linux-arm64/)
        assert.throws((): string => nwjsPlatform(win7, 'freebsd', 'x64'), /NW\.js has no build for freebsd/)
    })

    it('downloads a runtime once into the cache, checked with the checksums of its release', async (): Promise<void> => {
        const runtime = await downloadNwjs({version: 'win7', flavor: 'sdk'})
        assert.ok(existsSync(runtime.executable), runtime.executable)
        assert.ok(runtime.directory.startsWith(path.join(work, 'cache', 'nwjs')))
        assert.deepStrictEqual([runtime.version, runtime.flavor, runtime.node], ['0.72.0', 'sdk', '19.3.0'])
        assert.ok(existsSync(path.join(runtime.directory, 'credits.html')))
        const downloads: number = requests.filter((url: string): boolean => url.startsWith('/v0.72.0/nwjs-')).length
        assert.strictEqual((await downloadNwjs({version: '0.72.0', flavor: 'sdk'})).executable, runtime.executable)
        assert.strictEqual(requests.filter((url: string): boolean => url.startsWith('/v0.72.0/nwjs-')).length, downloads)
    })

    it('makes the application of NW.js of a project: its bundle for the Node.js of the release, its resources, its manifest', async (): Promise<void> => {
        const project: string = path.join(work, 'desk')
        mkdirSync(path.join(project, 'build'), {recursive: true})
        mkdirSync(path.join(project, 'host'), {recursive: true})
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({
            name: '@acme/Desk', productName: 'Desk', version: '1.2.3', type: 'module', main: 'build/App.js',
            lakutata: {nwjs: {version: 'win7', chromiumArgs: '--disable-gpu'}, installer: {appId: 'com.acme.Desk'}, resources: [{from: 'host', to: 'host'}]}
        }))
        writeFileSync(path.join(project, 'build', 'App.js'), 'export const ready = [1, 2].at(-1) === 2\nconsole.log(`ready ${ready}`)\n')
        writeFileSync(path.join(project, 'host', 'host.html'), '<!doctype html>')
        const stage: NwjsStage = await stageNwjsApp({project: project, outdir: '.nwjs/app'})
        assert.strictEqual(stage.directory, path.join(project, '.nwjs', 'app'))
        assert.deepStrictEqual([stage.release.version, stage.name], ['0.72.0', 'com.acme.desk'])
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(stage.directory, 'package.json'), 'utf8')), {
            name: 'com.acme.desk', productName: 'Desk', version: '1.2.3', main: 'main.js',
            webview: {partitions: [{name: 'trusted', accessible_resources: ['<all_urls>']}]},
            'chromium-args': '--disable-gpu'
        })
        assert.strictEqual(readFileSync(path.join(stage.directory, 'main.js'), 'utf8').split('\n')[1], "require('./app.cjs')")
        assert.ok(existsSync(path.join(stage.directory, 'resources', 'host', 'host.html')))
        //What the user interface is built for, written when it is not the release of the application
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'nwjs.json'), 'utf8')), {version: '0.72.0', node: '19.3.0', chromium: '109.0.5414.87'})
        //The background script runs the bundle (CommonJS) by require, as NW.js does
        assert.strictEqual(execFileSync(process.execPath, ['main.js'], {cwd: stage.directory}).toString().trim(), 'ready true')
        //Without a version of NW.js, or in the project itself
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'desk', version: '1.0.0', main: 'build/App.js'}))
        await assert.rejects(stageNwjsApp({project: project, outdir: 'out'}), /has no version of NW\.js: give it with lakutata nwjs use <version>/)
        await assert.rejects(stageNwjsApp({project: project, outdir: '.', version: 'win7'}), /made in a directory of its own/)
        await assert.rejects(stageNwjsApp({project: project, outdir: '..', version: 'win7'}), /made in a directory of its own/)
    })

    it('refuses an archive whose checksum is not the one of its release, and keeps nothing of it', async (): Promise<void> => {
        await assert.rejects(downloadNwjs({version: 'latest', flavor: 'sdk'}), /is not the one of NW\.js 0\.119\.2 \(sha256 [0-9a-f]{64}, 0{64} expected\)/)
        await assert.rejects(downloadNwjs({version: 'latest'}), /NW\.js 0\.119\.2 has no nwjs-v0\.119\.2-[a-z]+-[a-z0-9]+\.(zip|tar\.gz) in its checksums/)
        const kept: string[] = readdirSync(path.join(work, 'cache', 'nwjs')).filter((name: string): boolean => name.includes('0.119.2'))
        assert.deepStrictEqual(kept, [])
    })
})
