import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {BuildExecutable, BundleProject, ProgramName} from '../index.js'

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

    it('tells to build a resource which does not exist', async (): Promise<void> => {
        Write('package.json', JSON.stringify({name: 'missing', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'ui/dist', to: 'ui'}]}}))
        await assert.rejects(BundleProject({project: project}), /The resource ui\/dist does not exist: build it first/)
    })
})
