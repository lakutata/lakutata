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

    it('bundles the packages built on the framework holding addons: one copy of the framework, their addons shipped or told', async (): Promise<void> => {
        const project: string = path.join(work, 'device')
        const platform: string = `${process.platform}-${process.arch}`
        writeProject(project, {
            'package.json': JSON.stringify({name: 'device', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const {Component} = require('@lakutata/core')
const device = require('device')
const probe = require('probe')
const shadow = require('shadow')
require('legacy')
import('capture').then((capture) => console.log(Component === device.Component, Component === capture.Component, device.prebuilt(), '|', capture.binding, '|', probe.binding, probe.names, '|', shadow.given, shadow.declared))
`,
            'node_modules/@lakutata/core/package.json': JSON.stringify({name: '@lakutata/core', version: '1.0.0', main: 'index.js'}),
            'node_modules/@lakutata/core/index.js': 'exports.Component = class Component {}\n',
            //Its addons loaded by a path from its module (one by platform) and by a require
            'node_modules/device/package.json': JSON.stringify({name: 'device', version: '1.0.0', main: 'index.js', peerDependencies: {'@lakutata/core': '*'}}),
            'node_modules/device/index.js': `const path = require('node:path')
exports.Component = require('@lakutata/core').Component
exports.prebuilt = () => require('node:fs').readFileSync(path.join(__dirname, 'prebuilds', \`\${process.platform}-\${process.arch}\`, 'addon.node'), 'utf8')
exports.built = () => require('./build/Release/addon.node')
`,
            [`node_modules/device/prebuilds/${platform}/addon.node`]: 'prebuilt addon',
            'node_modules/device/build/Release/addon.node': 'built addon',
            //An addon package of lakutata add (its addon found by node-gyp-build from the directory of the package), built on
            //the framework
            'node_modules/capture/package.json': JSON.stringify({name: 'capture', version: '1.0.0', type: 'module', main: 'dist/index.js', dependencies: {'@lakutata/core': '*', 'node-gyp-build': '*'}}),
            'node_modules/capture/dist/index.js': `import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
export {Component} from '@lakutata/core'
export const binding = createRequire(import.meta.url)('node-gyp-build')(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
`,
            'node_modules/capture/build/Release/capture.node': 'capture addon',
            'node_modules/capture/build/Makefile': 'built by node-gyp',
            //node-gyp-build given the directory of the module itself, a property of the same name beside
            'node_modules/probe/package.json': JSON.stringify({name: 'probe', version: '1.0.0', main: 'index.js', dependencies: {'@lakutata/core': '*', 'node-gyp-build': '*'}}),
            'node_modules/probe/index.js': 'const names = {__dirname: \'a property\'}\nexports.binding = require(\'node-gyp-build\')(__dirname)\nexports.names = [names.__dirname, Object.keys({__dirname}).join()].join(\' \')\n',
            'node_modules/probe/build/Release/probe.node': 'probe addon',
            //A __dirname of its own (a parameter, a variable): not the directory of the module
            'node_modules/shadow/package.json': JSON.stringify({name: 'shadow', version: '1.0.0', main: 'index.js', dependencies: {'@lakutata/core': '*'}}),
            'node_modules/shadow/index.js': 'exports.given = ((__dirname) => __dirname)(\'a parameter\')\nexports.declared = (() => {\n    const {__dirname} = {__dirname: \'a variable\'}\n    return __dirname\n})()\nexports.built = () => require(\'./build/Release/shadow.node\')\n',
            'node_modules/shadow/build/Release/shadow.node': 'shadow addon',
            //Reads the addon instead of loading it (it is not one): the manifest of the directory, then build/Release
            'node_modules/node-gyp-build/package.json': JSON.stringify({name: 'node-gyp-build', version: '1.0.0', main: 'index.js'}),
            'node_modules/node-gyp-build/index.js': `const fs = require('node:fs'), path = require('node:path')
module.exports = (directory) => fs.readFileSync(path.join(directory, 'build', 'Release', JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name + '.node'), 'utf8')
`,
            //Its addon found from its manifest, resolved by its name: the bundler cannot follow it
            'node_modules/legacy/package.json': JSON.stringify({name: 'legacy', version: '1.0.0', main: 'index.js', dependencies: {'@lakutata/core': '*'}}),
            'node_modules/legacy/index.js': 'exports.load = () => require(require.resolve(\'legacy/package.json\').replace(\'package.json\', \'build/Release/legacy.node\'))\n',
            'node_modules/legacy/build/Release/legacy.node': 'legacy addon'
        })
        const result = await bundleProject({project: project})
        const files: string[] = result.native!.files.map((file): string => file.path)
        assert.deepStrictEqual(result.native!.modules, [])
        for (const file of [`node_modules/device/prebuilds/${platform}/addon.node`, 'node_modules/capture/build/Release/capture.node', 'node_modules/capture/package.json']) {
            assert.ok(files.includes(`.lakutata/files/${file}`), `${file}: ${files.join(', ')}`)
        }
        assert.ok(files.some((file: string): boolean => /^\.lakutata\/addons\/[0-9a-f]+-addon\.node$/.test(file)), files.join(', '))
        assert.ok(!files.some((file: string): boolean => file.includes('@lakutata/core') || file.endsWith('.js') || file.endsWith('Makefile')), files.join(', '))
        assert.deepStrictEqual(result.warnings.filter((warning: string): boolean => warning.startsWith('legacy: its native addon (build/Release/legacy.node) is not shipped')).length, 1, result.warnings.join('\n'))
        assert.ok(!result.warnings.some((warning: string): boolean => /^(device|capture):/.test(warning)), result.warnings.join('\n'))
        assert.strictEqual(runWithoutPackages(project, result.outfile), 'true true prebuilt addon | capture addon | probe addon a property __dirname | a parameter a variable')
    })

    it('ships the files of the packages of addons, without their sources and what built them (node-gyp, CMake, cargo)', async (): Promise<void> => {
        const project: string = path.join(work, 'built')
        const shipped: string[] = ['index.js', 'data/table.json', 'build/Release/addon.node', 'build/Release/libshared.dylib']
        const unused: string[] = ['cpp/binding.cc', 'deps/lib/libfixed.a', 'target/release/libaddon.dylib', 'build/Makefile', 'build/addon.target.mk', 'build/config.gypi',
            'build/Release/.deps/Release/addon.node.d', 'build/Release/obj.target/addon/cpp/binding.o', 'build/CMakeFiles/addon.dir/flags.make', 'build/CMakeCache.txt', 'build/build.ninja']
        writeProject(project, {
            'package.json': JSON.stringify({name: 'built', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': 'console.log(require(\'addon\').name)\n',
            'node_modules/addon/package.json': JSON.stringify({name: 'addon', version: '1.0.0', main: 'index.js'}),
            'node_modules/addon/Cargo.toml': '[package]\nname = "addon"\n',
            ...Object.fromEntries([...shipped, ...unused].filter((file: string): boolean => file !== 'index.js').map((file: string): [string, string] => [`node_modules/addon/${file}`, 'built'])),
            'node_modules/addon/index.js': 'exports.name = \'addon\'\n'
        })
        const result = await bundleProject({project: project})
        const files: string[] = result.native!.files.map((file): string => file.path)
        for (const file of shipped) assert.ok(files.includes(`node_modules/addon/${file}`), file)
        for (const file of unused) assert.ok(!files.includes(`node_modules/addon/${file}`), file)
        assert.strictEqual(runWithoutPackages(project, result.outfile), 'addon')
    })
})
