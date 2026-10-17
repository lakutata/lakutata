import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, execSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {buildExecutable, bundleProject} from '../index.js'

/**
 * Whether Bun is installed
 */
function hasBun(): boolean {
    try {
        execSync('bun --version', {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
}

/**
 * Write the files of a project
 * @param project
 * @param files
 */
function writeProject(project: string, files: Record<string, string>): void {
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(project, file)), {recursive: true})
        writeFileSync(path.join(project, file), content)
    }
}

/**
 * Run a bundle without the node_modules of its project: what it prints
 * @param project
 * @param bundle
 */
function runWithoutPackages(project: string, bundle: string): string {
    renameSync(path.join(project, 'node_modules'), path.join(project, 'node_modules.off'))
    try {
        return execFileSync(process.execPath, [bundle], {cwd: tmpdir(), timeout: 60000}).toString().trim()
    } finally {
        renameSync(path.join(project, 'node_modules.off'), path.join(project, 'node_modules'))
    }
}

describe('The dependencies of a bundle', (): void => {

    let work: string

    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-dependencies-'))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('leaves out the optional dependencies not installed: they throw when they are loaded, as without the bundle', async (): Promise<void> => {
        const project: string = path.join(work, 'optional')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'optional', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const {load} = require('store')
Promise.all([load('fakepg'), load('missingpkg')]).then((results) => console.log(results.join(' | ')))
`,
            //A package loading its drivers (its optional peer dependencies) by their names, as tsc writes import('pg')
            'node_modules/store/package.json': JSON.stringify({
                name: 'store', version: '1.0.0', main: 'index.js',
                peerDependencies: {fakepg: '*', missingpkg: '*'},
                peerDependenciesMeta: {fakepg: {optional: true}, missingpkg: {optional: true}}
            }),
            'node_modules/store/index.js': `const importStar = (m) => m && m.__esModule ? m : {default: m, ...m}
const DRIVERS = {
    fakepg: () => Promise.resolve().then(() => importStar(require('fakepg'))),
    missingpkg: () => Promise.resolve().then(() => importStar(require('missingpkg')))
}
exports.load = async (name) => {
    try {
        const driver = await DRIVERS[name]()
        return driver.tag ?? driver.default.tag
    } catch (error) {
        return 'missing ' + error.code
    }
}
`,
            'node_modules/fakepg/package.json': JSON.stringify({name: 'fakepg', version: '1.0.0', main: 'index.js'}),
            'node_modules/fakepg/index.js': 'exports.tag = \'fakepg bundled\'\n'
        })
        const result = await bundleProject({project: project})
        assert.strictEqual(runWithoutPackages(project, result.outfile), 'fakepg bundled | missing MODULE_NOT_FOUND')
    })

    it('loads the external modules of an executable from a node_modules next to it, whatever its runtime and its layout', async (): Promise<void> => {
        //Without native tree, and with one (a file the application reads by its path)
        const sources: Record<string, string> = {
            'external': 'console.log(require(\'extdemo\') + \' \' + require(\'node:path\').basename(\'/a/b\'))\n',
            'external-tree': 'console.log(require(\'extdemo\') + \' \' + require(\'node:fs\').readFileSync(require(\'node:path\').join(__dirname, \'b.txt\'), \'utf8\'))\n'
        }
        for (const [name, source] of Object.entries(sources)) {
            const project: string = path.join(work, name)
            writeProject(project, {
                'package.json': JSON.stringify({name: name, version: '1.0.0', main: 'build/index.js'}),
                'build/index.js': source,
                'build/b.txt': 'b',
                'node_modules/extdemo/package.json': JSON.stringify({name: 'extdemo', version: '1.0.0', main: 'index.js'}),
                'node_modules/extdemo/index.js': 'module.exports = \'external\'\n'
            })
            for (const runtime of hasBun() ? ['node', 'bun'] as const : ['node'] as const) {
                for (const layout of ['file', 'directory'] as const) {
                    const result = await buildExecutable({project: project, outdir: path.join(project, `executable-${runtime}-${layout}`), runtime: runtime, layout: layout, external: ['extdemo']})
                    //The module given next to the executable
                    cpSync(path.join(project, 'node_modules'), path.join(path.dirname(result.file), 'node_modules'), {recursive: true})
                    const printed: string = execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: path.join(work, `${name}-cache`)}, timeout: 60000}).toString().trim()
                    assert.strictEqual(printed, 'external b', `${name}, ${runtime}, ${layout}`)
                }
            }
        }
    })

    it('fails on the packages not installed which are not optional', async (): Promise<void> => {
        const project: string = path.join(work, 'required')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'required', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': 'require(\'notinstalled\')\n'
        })
        await assert.rejects(bundleProject({project: project}), /Could not resolve "notinstalled"/)
    })

    it('bundles the packages built on the framework with the application, their native dependencies in the tree', async (): Promise<void> => {
        const project: string = path.join(work, 'framework')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'framework', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': 'const component = require(\'component\')\nconsole.log(component.name, component.driver())\n',
            //A package built on the framework (one copy of its classes with the application), loading a native package
            'node_modules/component/package.json': JSON.stringify({name: 'component', version: '1.0.0', main: 'index.js', dependencies: {'@lakutata/core': '*', 'addon': '*'}}),
            'node_modules/component/index.js': 'exports.name = \'component\'\nexports.driver = () => require(\'addon\').name\n',
            'node_modules/addon/package.json': JSON.stringify({name: 'addon', version: '1.0.0', main: 'index.js'}),
            'node_modules/addon/index.js': 'exports.name = \'addon\'\n',
            'node_modules/addon/build/Release/addon.node': 'not loaded'
        })
        const result = await bundleProject({project: project})
        assert.deepStrictEqual(result.native?.modules, ['addon'])
        assert.strictEqual(runWithoutPackages(project, result.outfile), 'component addon')
    })
})
