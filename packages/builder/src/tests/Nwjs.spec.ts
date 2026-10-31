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
import {binaryArchitectures, nameNwjsNode, prepareNwjsAddons, usesV8Api} from '../lib/nwjs/Addons.js'
import {nsisScript, wixSource} from '../lib/win/Windows.js'

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

/**
 * A portable executable of the tests (PE32+): one section holding an import descriptor and a delay-load descriptor of
 * the libraries named
 * @param imported
 * @param delayed
 */
function portableExecutable(imported: string, delayed: string): Buffer {
    const file: Buffer = Buffer.alloc(0x400)
    file.writeUInt16LE(0x5a4d, 0)
    file.writeUInt32LE(0x80, 0x3c)
    file.writeUInt32LE(0x4550, 0x80)
    const coff: number = 0x84
    file.writeUInt16LE(0x8664, coff)
    file.writeUInt16LE(1, coff + 2)
    file.writeUInt16LE(240, coff + 16)
    const optional: number = coff + 20
    file.writeUInt16LE(0x20b, optional)
    file.writeBigUInt64LE(0x180000000n, optional + 24)
    const directories: number = optional + 112
    //The section .rdata: at 0x1000 in memory, 0x200 in the file
    const section: number = optional + 240
    file.write('.rdata', section, 'latin1')
    file.writeUInt32LE(0x200, section + 8)
    file.writeUInt32LE(0x1000, section + 12)
    file.writeUInt32LE(0x200, section + 16)
    file.writeUInt32LE(0x200, section + 20)
    const rva = (offset: number): number => offset - 0x200 + 0x1000
    //The imports at 0x200 (a descriptor, then an empty one), the delay-loaded ones at 0x240, the names at 0x300
    file.writeUInt32LE(rva(0x200), directories + 8)
    file.writeUInt32LE(40, directories + 12)
    file.writeUInt32LE(rva(0x300), 0x200 + 12)
    file.writeUInt32LE(rva(0x240), directories + 13 * 8)
    file.writeUInt32LE(64, directories + 13 * 8 + 4)
    file.writeUInt32LE(1, 0x240)
    file.writeUInt32LE(rva(0x320), 0x240 + 4)
    file.write(`${imported}\0`, 0x300, 'latin1')
    file.write(`${delayed}\0`, 0x320, 'latin1')
    return file
}

describe('The native addons of the applications of NW.js', (): void => {

    it('names node.dll the node.exe an addon of Windows imports, imported or delay-loaded, once', (): void => {
        const addon: Buffer = portableExecutable('KERNEL32.dll', 'NODE.EXE')
        assert.strictEqual(nameNwjsNode(addon), 1)
        assert.strictEqual(addon.toString('latin1', 0x320, 0x328), 'node.dll')
        assert.strictEqual(addon.toString('latin1', 0x300, 0x30c), 'KERNEL32.dll')
        assert.strictEqual(nameNwjsNode(addon), 0)
        const both: Buffer = portableExecutable('node.exe', 'node.exe')
        assert.strictEqual(nameNwjsNode(both), 2)
        assert.throws((): number => nameNwjsNode(Buffer.alloc(100)), /no MZ header/)
    })

    it('tells the architectures of a binary and whether it uses the API of V8', (): void => {
        const machO = (cpu: number): Buffer => Buffer.from([0xcf, 0xfa, 0xed, 0xfe, cpu & 0xff, 0, 0, 1])
        assert.deepStrictEqual(binaryArchitectures(machO(0x0c)), ['arm64'])
        const fat: Buffer = Buffer.alloc(48)
        fat.writeUInt32BE(0xcafebabe, 0)
        fat.writeUInt32BE(2, 4)
        fat.writeUInt32BE(0x01000007, 8)
        fat.writeUInt32BE(0x0100000c, 28)
        assert.deepStrictEqual(binaryArchitectures(fat), ['x64', 'arm64'])
        const elf: Buffer = Buffer.alloc(20)
        elf.writeUInt32BE(0x7f454c46, 0)
        elf.writeUInt16LE(62, 18)
        assert.deepStrictEqual(binaryArchitectures(elf), ['x64'])
        assert.deepStrictEqual(binaryArchitectures(portableExecutable('a.dll', 'b.dll')), ['x64'])
        assert.deepStrictEqual(binaryArchitectures(Buffer.from('text')), ['unknown'])
        assert.strictEqual(usesV8Api(Buffer.from('xx_ZN2v86String3NewEyy')), true)
        assert.strictEqual(usesV8Api(Buffer.from('?New@String@v8@@SA')), true)
        assert.strictEqual(usesV8Api(Buffer.from('napi_create_string_utf8')), false)
    })

    it('builds again from its sources a package whose addon is not for the architecture of the runtime', {skip: process.platform === 'win32' && 'built by MSVC on Windows (checked on the machine of Windows)'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-nwjs-addons-'))
        try {
            const source: string = path.join(work, 'project', 'node_modules', 'hello-addon')
            mkdirSync(path.join(source, 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(source, 'package.json'), JSON.stringify({name: 'hello-addon', version: '1.0.0', main: 'index.js'}))
            writeFileSync(path.join(source, 'binding.gyp'), "{'targets': [{'target_name': 'hello', 'sources': ['hello.c']}]}")
            writeFileSync(path.join(source, 'hello.c'), '#include <node_api.h>\nNAPI_MODULE_INIT() { return exports; }\n')
            //Built for another architecture: an ELF of arm (x64 on arm)
            const foreign: Buffer = Buffer.alloc(64)
            foreign.writeUInt32BE(0x7f454c46, 0)
            foreign.writeUInt16LE(process.arch === 'arm' ? 62 : 40, 18)
            writeFileSync(path.join(source, 'build', 'Release', 'hello.node'), foreign)
            const tree: string = path.join(work, 'tree')
            mkdirSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'), foreign)
            const release: NwjsRelease = {version: '0.72.0', date: '', node: '19.3.0', chromium: '109.0.5414.87', platforms: []}
            const platform: string = `${process.platform === 'darwin' ? 'osx' : 'linux'}-${process.arch}`
            const files = [{path: 'node_modules/hello-addon/build/Release/hello.node', source: path.join(source, 'build', 'Release', 'hello.node'), mode: 0o644}]
            const result = await prepareNwjsAddons(path.join(work, 'project'), tree, files, release, platform)
            assert.deepStrictEqual(result, {renamed: [], rebuilt: ['hello-addon']})
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))), [process.arch])
            //Without its sources, it cannot be built again
            rmSync(path.join(source, 'binding.gyp'))
            writeFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'), foreign)
            await assert.rejects(prepareNwjsAddons(path.join(work, 'project'), tree, files, release, platform), /hello-addon has no sources to build its addons for NW\.js \(binding\.gyp\)/)
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('refuses an addon using the API of V8 for a release of NW.js before 0.111.3', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-nwjs-v8-'))
        try {
            mkdirSync(path.join(work, 'tree', 'node_modules', 'sqlite', 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(work, 'tree', 'node_modules', 'sqlite', 'build', 'Release', 'sqlite.node'), Buffer.from('\x7fELF..._ZN2v86Object3New'))
            const files = [{path: 'node_modules/sqlite/build/Release/sqlite.node', source: path.join(work, 'sqlite.node'), mode: 0o644}]
            await assert.rejects(prepareNwjsAddons(work, path.join(work, 'tree'), files, {version: '0.72.0', date: '', node: '19.3.0', chromium: '', platforms: []}, 'linux-x64'), /uses the API of V8 \(not Node-API\): it runs in NW\.js 0\.111\.3 or later, built with its headers; NW\.js 0\.72\.0 needs a package of Node-API instead/)
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('refuses an addon using the API of V8 for the 32-bit Windows of a release publishing no library of it', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-nwjs-v8-'))
        //A mirror without the library of 32-bit Windows
        const requests: string[] = []
        const server: Server = createServer((request: IncomingMessage, response: ServerResponse): unknown => requests.push(request.url!) && response.writeHead(404).end())
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        const mirror: string | undefined = process.env.LAKUTATA_NWJS_MIRROR
        process.env.LAKUTATA_NWJS_MIRROR = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        try {
            const source: string = path.join(work, 'node_modules', 'sqlite')
            mkdirSync(path.join(source, 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(source, 'package.json'), JSON.stringify({name: 'sqlite', version: '1.0.0'}))
            writeFileSync(path.join(source, 'binding.gyp'), '{}')
            writeFileSync(path.join(source, 'build', 'Release', 'sqlite.node'), Buffer.from('MZ...?New@Object@v8@@'))
            mkdirSync(path.join(work, 'tree', 'node_modules', 'sqlite', 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(work, 'tree', 'node_modules', 'sqlite', 'build', 'Release', 'sqlite.node'), Buffer.from('MZ...?New@Object@v8@@'))
            const files = [{path: 'node_modules/sqlite/build/Release/sqlite.node', source: path.join(source, 'build', 'Release', 'sqlite.node'), mode: 0o644}]
            await assert.rejects(prepareNwjsAddons(work, path.join(work, 'tree'), files, {version: '0.119.2', date: '', node: '26.12.1', chromium: '', platforms: []}, 'win-ia32'), /NW\.js 0\.119\.2 publishes no library of 32-bit Windows \(node\.lib\) to build the addons using V8 with/)
            assert.deepStrictEqual(requests, ['/v0.119.2/node.lib'])
        } finally {
            if (mirror === undefined) delete process.env.LAKUTATA_NWJS_MIRROR
            else process.env.LAKUTATA_NWJS_MIRROR = mirror
            await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
            rmSync(work, {recursive: true, force: true})
        }
    })
})

describe('The installers of the desktop applications', (): void => {

    /**
     * The plan of a desktop application of the tests
     * @param arch
     * @param stage
     */
    const plan = (arch: string, stage: string): Parameters<typeof nsisScript>[0] => ({
        name: 'desk', appId: 'com.acme.desk', productName: 'Desk', program: 'desk', version: '1.2.3', description: 'The desk', maintainer: 'Acme <dev@acme.test>',
        addToPath: false, depends: [], recommends: [], directory: stage, prefix: 'C:\\Program Files\\desk', scripts: {}, arch: arch, desktop: {executable: 'desk.exe'}
    })

    it('installs a desktop application of Windows with its shortcuts, without the script of the service and of the PATH', (): void => {
        const stage: string = mkdtempSync(path.join(tmpdir(), 'lakutata-desktop-'))
        try {
            writeFileSync(path.join(stage, 'desk.exe'), '')
            const wide: string = nsisScript(plan('x64', stage), stage, 'desk-setup.exe', {hooks: {}})
            assert.match(wide, /InstallDir "\$PROGRAMFILES64\\desk"/)
            assert.match(wide, /!include "x64\.nsh"/)
            assert.match(wide, /IfFileExists "\$INSTDIR\\desk\.exe" 0 \+2/)
            assert.match(wide, /CreateShortCut "\$SMPROGRAMS\\Desk\.lnk" "\$INSTDIR\\desk\.exe"/)
            assert.match(wide, /CreateShortCut "\$DESKTOP\\Desk\.lnk" "\$INSTDIR\\desk\.exe"/)
            assert.match(wide, /Delete "\$DESKTOP\\Desk\.lnk"/)
            assert.match(wide, /"DisplayIcon" "\$INSTDIR\\desk\.exe"/)
            assert.doesNotMatch(wide, /installer\.ps1/)
            //The 32-bit application of Windows 7: the programs and the registry of 32 bits
            const narrow: string = nsisScript(plan('ia32', stage), stage, 'desk-setup.exe', {hooks: {}})
            assert.match(narrow, /InstallDir "\$PROGRAMFILES\\desk"/)
            assert.doesNotMatch(narrow, /x64\.nsh|SetRegView 64/)
            const msi: string = wixSource(plan('ia32', stage), stage, stage, undefined)
            assert.match(msi, /<Directory Id="ProgramFilesFolder">/)
            assert.match(msi, /<Shortcut Id="ProgramMenuShortcut" Directory="ProgramMenuFolder" Name="Desk" Target="\[INSTALLDIR\]desk\.exe"/)
            assert.match(msi, /<RegistryValue Root="HKCU" Key="Software\\com\.acme\.desk" Name="Shortcuts" Type="integer" Value="1" KeyPath="yes"\/>/)
            assert.match(msi, /<ComponentRef Id="Shortcuts"\/>/)
            assert.doesNotMatch(msi, /CommonAppDataFolder|ComponentRef Id="Data"/)
            assert.match(wixSource(plan('x64', stage), stage, stage, undefined), /<Directory Id="ProgramFiles64Folder">/)
        } finally {
            rmSync(stage, {recursive: true, force: true})
        }
    })
})
