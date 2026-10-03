import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {BuildExecutable, BuildInstaller, BundleProject, ProgramName} from '../index.js'

describe('The builder of the applications', (): void => {

    let project: string

    /**
     * Write a file of the project
     * @param file
     * @param content
     */
    function Write(file: string, content: string): void {
        mkdirSync(path.dirname(path.join(project, file)), {recursive: true})
        writeFileSync(path.join(project, file), content)
    }

    before((): void => {
        project = mkdtempSync(path.join(tmpdir(), 'lakutata-builder-'))
        //An application reading its resource where the packed applications are told it is (ResourcesPath of lakutata)
        Write('package.json', JSON.stringify({name: '@acme/reader', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'data', to: 'texts'}]}}))
        Write('data/hello.txt', 'Hello')
        Write('build/index.js', `const resources = globalThis[Symbol.for('lakutata.packaged')].resources()
console.log(require('./words.js') + ' ' + require('node:fs').readFileSync(require('node:path').join(resources, 'texts', 'hello.txt'), 'utf8'))`)
        Write('build/words.js', `module.exports = 'read'`)
    })

    after((): void => rmSync(project, {recursive: true, force: true}))

    it('names the program after the bin of the package, else its name without its scope', (): void => {
        assert.strictEqual(ProgramName({name: '@acme/reader', bin: {read: 'index.js'}}), 'read')
        assert.strictEqual(ProgramName({name: '@acme/reader'}), 'reader')
    })

    it('bundles the application, its resources next to it', async (): Promise<void> => {
        const result = await BundleProject({project: project})
        assert.strictEqual(result.outfile, path.join(project, 'dist', 'reader.cjs'))
        assert.deepStrictEqual(result.resources, ['texts'])
        assert.strictEqual(result.resourcesDirectory, path.join(project, 'dist', 'reader.resources'))
        assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), 'read Hello')
    })

    it('makes the executable in a directory, which runs without Node.js', async (): Promise<void> => {
        const result = await BuildExecutable({project: project, layout: 'directory'})
        assert.match(result.runtime, /^Node\.js v\d+/)
        assert.strictEqual(result.directory, path.join(project, 'dist', 'reader'))
        assert.deepStrictEqual(readdirSync(result.directory!).sort(), [path.basename(result.file), 'resources'].sort())
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('makes the installers of macOS: the package of its installer, the archive of the directory', {skip: process.platform !== 'darwin' && 'made on macOS'}, async (): Promise<void> => {
        Write('package.json', JSON.stringify({
            name: '@acme/reader', version: '1.2.3', description: 'Reads', main: 'build/index.js', bin: {read: 'build/index.js'},
            lakutata: {resources: [{from: 'data', to: 'texts'}], installer: {name: 'reader', appId: 'com.acme.reader', service: {env: {PORT: '18080'}, args: ['--serve']}}}
        }))
        const result = await BuildInstaller({project: project})
        const arch: string = process.arch
        assert.deepStrictEqual(result.files.map(({target, file}): string => `${target} ${path.basename(file)}`), [`pkg reader-1.2.3-${arch}.pkg`, `tar.gz reader-1.2.3-darwin-${arch}.tar.gz`])
        //Its payload: the application in /usr/local/lib, its program in the PATH, its service
        const expanded: string = path.join(project, 'expanded')
        execFileSync('pkgutil', ['--expand-full', result.files[0].file, expanded])
        const component: string = path.join(expanded, readdirSync(expanded).find((name: string): boolean => name.endsWith('.pkg'))!)
        const payload: string = path.join(component, 'Payload')
        assert.deepStrictEqual(readdirSync(path.join(payload, 'usr', 'local', 'lib', 'reader')).sort(), ['read', 'resources', 'uninstall'])
        assert.strictEqual(readlinkSync(path.join(payload, 'usr', 'local', 'bin', 'read')), '../lib/reader/read')
        const daemon: string = path.join(payload, 'Library', 'LaunchDaemons', 'com.acme.reader.plist')
        execFileSync('plutil', ['-lint', daemon])
        const job = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', daemon]).toString())
        assert.deepStrictEqual(job.ProgramArguments.slice(3), ['/usr/local/lib/reader/read', '--serve'])
        assert.strictEqual(job.UserName, '_reader')
        assert.deepStrictEqual(job.KeepAlive, {SuccessfulExit: false})
        assert.strictEqual(job.WorkingDirectory, '/usr/local/var/lib/reader')
        //Its scripts are sh, its program runs from the payload
        execFileSync('sh', ['-n', path.join(component, 'Scripts', 'postinstall')])
        execFileSync('sh', ['-n', path.join(payload, 'usr', 'local', 'lib', 'reader', 'uninstall')])
        assert.match(readFileSync(path.join(component, 'Scripts', 'postinstall'), 'utf8'), /PORT="18080"/)
        assert.ok(lstatSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read')).mode & 0o111)
        assert.strictEqual(execFileSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read'), [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('tells to build a resource which does not exist', async (): Promise<void> => {
        Write('package.json', JSON.stringify({name: 'missing', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'ui/dist', to: 'ui'}]}}))
        await assert.rejects(BundleProject({project: project}), /The resource ui\/dist does not exist: build it first/)
    })
})
