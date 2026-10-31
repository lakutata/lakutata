import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {MOBILE_NODE_VERSION, stageMobileApp, type MobileStage} from '../index.js'
import {nativeBanner} from '../lib/NativeRuntime.js'

describe('The Node.js projects of the mobile applications', (): void => {

    it('make the bundle for the Node.js of iOS and Android, its resources, its manifest and its entry', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = path.join(work, 'app')
            mkdirSync(path.join(project, 'build'), {recursive: true})
            mkdirSync(path.join(project, 'assets'), {recursive: true})
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: '@acme/mobile', version: '1.2.3', type: 'module', main: 'build/App.js', lakutata: {resources: [{from: 'assets', to: 'assets'}]}}))
            //The application: the bridge of the plugin, required at run time
            writeFileSync(path.join(project, 'build', 'App.js'), `import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
const {app} = createRequire(import.meta.url)('bridge')
console.log('RESULT ' + JSON.stringify({fetch: typeof fetch, tmpdir: tmpdir(), datadir: app.datadir()}))
`)
            writeFileSync(path.join(project, 'assets', 'logo.txt'), 'logo')
            const stage: MobileStage = await stageMobileApp({platform: 'android', project: project, outdir: path.join(work, 'ui', 'dist', 'nodejs')})
            assert.strictEqual(stage.directory, path.join(work, 'ui', 'dist', 'nodejs'))
            assert.deepStrictEqual([stage.platform, stage.node], ['android', MOBILE_NODE_VERSION])
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(stage.directory, 'package.json'), 'utf8')), {name: '@acme/mobile', version: '1.2.3', private: true, main: 'main.js'})
            assert.ok(existsSync(path.join(stage.directory, 'app.cjs')))
            assert.strictEqual(readFileSync(path.join(stage.directory, 'resources', 'assets', 'logo.txt'), 'utf8'), 'logo')
            //The plugin's bridge, found through its NODE_PATH; a system without WebAssembly (iOS) and a temporary directory
            //that cannot be written (Android)
            const modules: string = path.join(work, 'modules')
            mkdirSync(path.join(modules, 'bridge'), {recursive: true})
            writeFileSync(path.join(modules, 'bridge', 'index.js'), `module.exports = {app: {datadir: () => ${JSON.stringify(path.join(work, 'data', 'files'))}}}`)
            const readOnly: string = path.join(work, 'read-only')
            mkdirSync(readOnly)
            chmodSync(readOnly, 0o555)
            const run = spawnSync(process.execPath, ['-e', `delete globalThis.WebAssembly; require(${JSON.stringify(path.join(stage.directory, 'main.js'))})`], {
                encoding: 'utf8',
                env: {...process.env, NODE_PATH: modules, TMPDIR: readOnly},
                timeout: 30000
            })
            assert.strictEqual(run.status, 0, run.stdout + run.stderr)
            const result = JSON.parse(run.stdout.split('\n').find((line: string): boolean => line.startsWith('RESULT '))!.slice('RESULT '.length))
            assert.deepStrictEqual(result, {fetch: 'undefined', tmpdir: path.join(work, 'data', 'cache'), datadir: path.join(work, 'data', 'files')})
            assert.ok(existsSync(path.join(work, 'data', 'cache')))
            //Made again in a directory of its own only
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: '.'}), /made in a directory of its own/)
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('load the native tree of the architecture first, the tree next to the bundle else', (): void => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //A package of the tree, in the tree of every architecture and in the one of the architecture of the machine
            for (const [directory, built] of [['app.native', 'every architecture'], [`app.native-${process.arch}`, process.arch]]) {
                mkdirSync(path.join(work, directory, 'node_modules', 'addon'), {recursive: true})
                writeFileSync(path.join(work, directory, 'node_modules', 'addon', 'index.js'), `module.exports = ${JSON.stringify(built)}`)
            }
            writeFileSync(path.join(work, 'app.cjs'), `${nativeBanner({name: 'app', hash: '', directory: 'app.native', modules: ['addon'], embedded: false})}console.log(require('addon'))\n`)
            const loaded = (): string => spawnSync(process.execPath, [path.join(work, 'app.cjs')], {encoding: 'utf8'}).stdout.trim()
            assert.strictEqual(loaded(), process.arch)
            rmSync(path.join(work, `app.native-${process.arch}`), {recursive: true})
            assert.strictEqual(loaded(), 'every architecture')
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('refuse the native addons for now, the directory made removed', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = path.join(work, 'app')
            const addon: string = path.join(project, 'node_modules', 'hello-addon')
            mkdirSync(path.join(addon, 'build', 'Release'), {recursive: true})
            mkdirSync(path.join(project, 'build'), {recursive: true})
            writeFileSync(path.join(addon, 'package.json'), JSON.stringify({name: 'hello-addon', version: '1.0.0', main: 'index.js'}))
            writeFileSync(path.join(addon, 'index.js'), `module.exports = require('./build/Release/hello.node')`)
            writeFileSync(path.join(addon, 'build', 'Release', 'hello.node'), Buffer.from('\x7fELF'))
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'mobile', version: '1.0.0', main: 'build/App.js', dependencies: {'hello-addon': '1.0.0'}}))
            writeFileSync(path.join(project, 'build', 'App.js'), `console.log(require('hello-addon'))`)
            const outdir: string = path.join(work, 'nodejs')
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir}), /The native addons of the application are not built for iOS and Android yet: hello-addon$/)
            assert.ok(!existsSync(outdir))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })
})
