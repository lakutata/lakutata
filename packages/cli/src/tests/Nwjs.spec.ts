import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, ROOT, runCommand} from './support/Workspace.js'

/**
 * The releases of the tests: the latest, the last one of Windows 7 (no osx-arm64), one embedding Node.js 18.5
 */
const VERSIONS = {
    versions: [
        {version: 'v0.119.2', date: '2026/10/22', files: ['win-x64', 'win-ia32', 'win-arm64', 'osx-x64', 'osx-arm64', 'linux-x64', 'linux-arm64'], components: {node: '26.12.1', chromium: '156.0.8078.48'}},
        {version: 'v0.72.0', date: '2023/01/13', files: ['win-x64', 'win-ia32', 'osx-x64', 'linux-x64', 'linux-ia32'], components: {node: '19.3.0', chromium: '109.0.5414.87'}},
        {version: 'v0.69.1', date: '2022/09/29', files: ['win-x64', 'osx-x64', 'linux-x64'], components: {node: '18.5.0', chromium: '106.0.5249.91'}}
    ]
}

/**
 * The name of the build of the machine in a release, as NW.js names it
 * @param files
 */
function platformOf(files: string[]): string {
    const system: string = {win32: 'win', darwin: 'osx', linux: 'linux'}[process.platform as string]!
    const name: string = `${system}-${process.arch}`
    return files.includes(name) ? name : `${system}-x64`
}

describe('lakutata nwjs', (): void => {

    let work: string
    let server: Server
    let env: NodeJS.ProcessEnv
    const files: Map<string, Buffer> = new Map()

    /**
     * Run the command in a directory
     * @param args
     * @param cwd
     * @param extra
     */
    const run = (args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}): Promise<{ code: number, output: string }> => runCommand(process.execPath, [CLI, ...args], cwd, {...env, ...extra})

    before(async (): Promise<void> => {
        //The real path: the current directory of the command is one (/private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-nwjs-')))
        files.set('/versions.json', Buffer.from(JSON.stringify(VERSIONS)))
        //A fake runtime of 0.72.0 for the machine (POSIX: its executable a script writing its arguments)
        const platform: string = platformOf(VERSIONS.versions[1].files)
        const name: string = `nwjs-sdk-v0.72.0-${platform}`
        const source: string = mkdtempSync(path.join(work, 'archive-'))
        const executable: string[] = platform.startsWith('osx-') ? ['nwjs.app', 'Contents', 'MacOS', 'nwjs'] : [platform.startsWith('win-') ? 'nw.exe' : 'nw']
        mkdirSync(path.join(source, name, ...executable.slice(0, -1)), {recursive: true})
        writeFileSync(path.join(source, name, ...executable), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NW_ARGS"\n', {mode: 0o755})
        const archive: string = `${name}.${platform.startsWith('linux-') ? 'tar.gz' : 'zip'}`
        if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', name, archive], {cwd: source})
        else execFileSync('tar', platform.startsWith('linux-') ? ['-czf', archive, name] : ['-a', '-cf', archive, name], {cwd: source})
        const content: Buffer = readFileSync(path.join(source, archive))
        files.set(`/v0.72.0/${archive}`, content)
        files.set('/v0.72.0/SHASUMS256.txt', Buffer.from(`${createHash('sha256').update(content).digest('hex')}  ${archive}\n`))
        server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            const content: Buffer | undefined = files.get(request.url!)
            response.writeHead(content ? 200 : 404).end(content)
        })
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        const url: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        env = {...process.env, LAKUTATA_CACHE_DIR: path.join(work, 'cache'), LAKUTATA_NWJS_VERSIONS: `${url}/versions.json`, LAKUTATA_NWJS_MIRROR: url}
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
        rmSync(work, {recursive: true, force: true})
    })

    it('lists the releases lakutata runs on, the latest and the one of Windows 7 marked', async (): Promise<void> => {
        const listed = await run(['nwjs', 'versions'], work)
        assert.strictEqual(listed.code, 0, listed.output)
        assert.match(listed.output, /0\.119\.2 +2026\/10\/22 +Node\.js 26\.12\.1 +Chromium 156 .*\(latest\)/)
        assert.match(listed.output, /0\.72\.0 +2023\/01\/13 +Node\.js 19\.3\.0 +Chromium 109 .*\(win7: the last one running on Windows 7, 8 and 8\.1\)/)
        assert.doesNotMatch(listed.output, /0\.69\.1/)
    })

    it('gives the application its version of NW.js, its Node.js and its Chromium written into nwjs.json', async (): Promise<void> => {
        const project: string = path.join(work, 'use')
        mkdirSync(project)
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'desk', version: '1.0.0', lakutata: {resources: []}}))
        const used = await run(['nwjs', 'use', 'win7'], project)
        assert.strictEqual(used.code, 0, used.output)
        assert.match(used.output, /NW\.js 0\.72\.0: Node\.js 19\.3\.0, Chromium 109\.0\.5414\.87/)
        assert.match(used.output, /Runs on Windows 7 or later, macOS \(Intel; Apple silicon through Rosetta\), Linux \(x64, ia32\)/)
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).lakutata, {resources: [], nwjs: {version: '0.72.0'}})
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'nwjs.json'), 'utf8')), {version: '0.72.0', node: '19.3.0', chromium: '109.0.5414.87'})
        assert.match((await run(['nwjs', 'use', 'latest'], project)).output, /Runs on Windows 10 or later, macOS \(Intel, Apple silicon\)/)
        const refused = await run(['nwjs', 'use', '0.69.1'], project)
        assert.notStrictEqual(refused.code, 0)
        assert.match(refused.output, /embeds Node\.js 18\.5\.0: lakutata runs on Node\.js 18\.10\.0 or later/)
    })

    it('runs the compiled application in the NW.js of the development, its arguments given', {skip: process.platform === 'win32' && 'the fake runtime is a script'}, async (): Promise<void> => {
        const project: string = path.join(work, 'run')
        mkdirSync(path.join(project, 'build'), {recursive: true})
        symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir')
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'desk', version: '1.0.0', type: 'module', main: 'build/App.js', lakutata: {nwjs: {version: '0.72.0'}}}))
        writeFileSync(path.join(project, 'build', 'App.js'), 'console.log("desk")\n')
        const argsFile: string = path.join(work, 'args.txt')
        const ran = await run(['nwjs', 'run', '--', '--ui=http://localhost:5173'], project, {NW_ARGS: argsFile})
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, /NW\.js 0\.72\.0 \(sdk, [a-z]+-[a-z0-9]+\): Node\.js 19\.3\.0, Chromium 109/)
        assert.deepStrictEqual(readFileSync(argsFile, 'utf8').trim().split('\n'), [path.join(project, '.nwjs', 'app'), '--ui=http://localhost:5173'])
        assert.strictEqual(JSON.parse(readFileSync(path.join(project, '.nwjs', 'app', 'package.json'), 'utf8')).main, 'main.js')
    })
})
