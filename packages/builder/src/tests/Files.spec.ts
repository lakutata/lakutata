import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {buildExecutable, bundleProject} from '../index.js'

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
 * Link packages of the repository into the node_modules of a project (the pools of workers of the tests, never named by
 * the builder)
 * @param project
 * @param names
 */
function linkPackages(project: string, names: string[]): void {
    const require: NodeJS.Require = createRequire(import.meta.url)
    for (const name of names) {
        //The directory of the package: the one of its entry holding its package.json (its exports may hide it)
        let root: string = path.dirname(require.resolve(name))
        while (!existsSync(path.join(root, 'package.json')) || JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name !== name) root = path.dirname(root)
        const target: string = path.join(project, 'node_modules', name)
        mkdirSync(path.dirname(target), {recursive: true})
        symlinkSync(realpathSync(root), target, 'dir')
    }
}

/**
 * Run a bundle without the sources of its project: what it prints
 * @param project
 * @param bundle
 * @param sources the directories of the project moved away while it runs
 */
function runWithout(project: string, bundle: string, sources: string[]): string {
    for (const source of sources) renameSync(path.join(project, source), path.join(project, `${source}.off`))
    try {
        return execFileSync(process.execPath, [bundle], {cwd: tmpdir(), timeout: 60000}).toString().trim()
    } finally {
        for (const source of sources) renameSync(path.join(project, `${source}.off`), path.join(project, source))
    }
}

/**
 * Whether Bun is installed
 */
function hasBun(): boolean {
    try {
        execFileSync('bun', ['--version'], {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
}

/**
 * What the workers of the applications answer, one line each, in the order they are started
 */
const EXPECTED: string = [
    'join: from the worker join',
    'url: from the worker url',
    'constant: nested ok',
    'concatenation: from the worker concatenation',
    'template: from the worker template',
    'resolve: from the worker resolve',
    'tsc: from the worker tsc',
    'job a: a',
    'job b: b',
    'parent: shared',
    'package: pooled'
].join('\n')

describe('The files a bundle reads by their paths', (): void => {

    let work: string
    let common: string

    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-workers-'))
        common = path.join(work, 'common')
        //A CommonJS application starting its workers the ways tsc, its developers and its packages write it
        writeProject(common, {
            'package.json': JSON.stringify({name: 'workers', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const {Worker} = require('node:worker_threads')
const path = require('node:path')
const node_worker_threads_1 = require('node:worker_threads')
const node_path_1 = require('node:path')
const pool = require('pool')
const helper = path.resolve(__dirname, 'lib', 'helper.js')
const started = [
    ['join', new Worker(path.join(__dirname, 'worker.js'), {workerData: 'join'})],
    ['url', new Worker(new URL('./worker.js', require('node:url').pathToFileURL(__filename)), {workerData: 'url'})],
    ['constant', new Worker(helper)],
    ['concatenation', new Worker(__dirname + '/worker.js', {workerData: 'concatenation'})],
    ['template', new Worker(\`\${__dirname}/worker.js\`, {workerData: 'template'})],
    ['resolve', new Worker(require.resolve('./worker.js'), {workerData: 'resolve'})],
    ['tsc', new node_worker_threads_1.Worker((0, node_path_1.join)(__dirname, 'worker.js'), {workerData: 'tsc'})],
    ...['a', 'b'].map((name) => ['job ' + name, new Worker(path.join(__dirname, 'jobs', \`\${name}.js\`))]),
    ['parent', new Worker(path.join(__dirname, '..', 'shared', 'worker.js'))],
    ['package', pool.start()]
]
Promise.all(started.map(([name, worker]) => new Promise((resolve, reject) => worker.once('message', (message) => resolve(name + ': ' + message)).once('error', reject))))
    .then((lines) => console.log(lines.join('\\n')))
`,
            'build/worker.js': `const {parentPort, workerData} = require('node:worker_threads')
parentPort.postMessage(require('./lib/words.js') + ' ' + workerData)
`,
            'build/lib/words.js': 'module.exports = \'from the worker\'\n',
            //A worker starting its own worker
            'build/lib/helper.js': `const {Worker, parentPort} = require('node:worker_threads')
new Worker(require('node:path').join(__dirname, 'nested.js')).once('message', (message) => parentPort.postMessage('nested ' + message))
`,
            'build/lib/nested.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'ok\')\n',
            'build/jobs/a.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'a\')\n',
            'build/jobs/b.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'b\')\n',
            'build/jobs/notes.md': 'Not a script\n',
            'shared/worker.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'shared\')\n',
            //A package starting its worker, and the workers its users give (not warned of)
            'node_modules/pool/package.json': JSON.stringify({name: 'pool', version: '1.0.0', main: 'index.js'}),
            'node_modules/pool/index.js': `const {Worker} = require('node:worker_threads')
exports.start = () => new Worker(require('node:path').join(__dirname, 'job.js'))
exports.run = (file) => new Worker(file)
`,
            'node_modules/pool/job.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'pooled\')\n'
        })
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('bundles the scripts the workers run into the native tree, their paths rewritten, run from any directory', async (): Promise<void> => {
        const result = await bundleProject({project: common})
        assert.deepStrictEqual(result.warnings, [])
        assert.deepStrictEqual(result.workers, ['build/jobs/a.js', 'build/jobs/b.js', 'build/lib/helper.js', 'build/lib/nested.js', 'build/worker.js', 'node_modules/pool/job.js', 'shared/worker.js'])
        const workers: string = path.join(result.nativeDirectory!, '.lakutata', 'files')
        //The directories of the scripts, mirrored; the scripts bundled as CommonJS whatever the type of the project
        assert.ok(existsSync(path.join(workers, 'build', 'jobs', 'a.js')) && !existsSync(path.join(workers, 'build', 'jobs', 'notes.md')))
        assert.ok(existsSync(path.join(workers, 'shared', 'worker.js')) && existsSync(path.join(workers, 'package.json')))
        //The sources of the application are not shipped: its workers run from the tree
        const sources: string[] = ['build', 'shared', 'node_modules']
        for (const source of sources) renameSync(path.join(common, source), path.join(common, `${source}.off`))
        try {
            assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), EXPECTED)
        } finally {
            for (const source of sources) renameSync(path.join(common, `${source}.off`), path.join(common, source))
        }
    })

    it('bundles the workers of an ES module application started by the URLs of its modules', async (): Promise<void> => {
        const project: string = path.join(work, 'module')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'module-workers', version: '1.0.0', type: 'module', main: 'build/index.js'}),
            'build/index.js': `import {Worker} from 'node:worker_threads'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workers = [
    new Worker(new URL('./worker.js', import.meta.url), {workerData: 'url'}),
    new Worker(path.join(__dirname, 'worker.js'), {workerData: 'dirname'}),
    new Worker(path.join(import.meta.dirname, 'worker.js'), {workerData: 'meta'})
]
Promise.all(workers.map((worker) => new Promise((resolve) => worker.once('message', resolve)))).then((lines) => console.log(lines.join(',')))
`,
            'build/worker.js': `import {parentPort, workerData} from 'node:worker_threads'
parentPort.postMessage('module ' + workerData)
`
        })
        const result = await bundleProject({project: project})
        assert.deepStrictEqual(result.warnings, [])
        assert.deepStrictEqual(result.workers, ['build/worker.js'])
        assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), 'module url,module dirname,module meta')
    })

    it('follows the paths to scripts wherever they are given: the options of the pools of workers, the properties of the classes, fork, require', async (): Promise<void> => {
        const project: string = path.join(work, 'anywhere')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'anywhere', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const path = require('node:path')
const {fork} = require('node:child_process')
const worker_threads_1 = require('node:worker_threads')
const {Piscina} = require('piscina')
const workerpool = require('workerpool')
const {Tinypool} = require('tinypool')
//The consumers of a queue named Worker, as the ones of the queues of jobs: not threads, not warned of
class Worker {
    constructor(queue, processor) {
        this.queue = queue
        this.processor = processor
    }
}
class Predictions {
    workerPath = path.resolve(__dirname, '..', 'workers', 'predict.js')
    constructor() {
        this.legacyPath = path.join(__dirname, 'lib', 'legacy.js')
    }
    predict(n) {
        return answer(new worker_threads_1.Worker(this.workerPath, {workerData: n}))
    }
    legacy() {
        return answer(new worker_threads_1.Worker(this.legacyPath))
    }
}
function answer(worker) {
    return new Promise((resolve, reject) => worker.once('message', resolve).once('error', reject))
}
async function main() {
    new Worker('extraction', async () => undefined)
    const piscina = new Piscina({filename: require.resolve(path.resolve(__dirname, 'lib/Double'))})
    const pool = workerpool.pool(path.join(__dirname, 'lib', 'pooled.js'))
    const tinypool = new Tinypool({filename: path.resolve(__dirname, 'lib', 'Double.js')})
    const predictions = new Predictions()
    const child = fork(path.join(__dirname, 'child.js'))
    //Listened to at once: the child answers when it starts
    const forked = answer(child)
    const lines = [
        'piscina ' + await piscina.run(2),
        //Its pool does not answer under Bun, bundled or not
        process.versions.bun ? 'workerpool skipped' : 'workerpool ' + await pool.exec('triple', [2]),
        'tinypool ' + await tinypool.run(3),
        'property ' + await predictions.predict(5),
        'assigned ' + await predictions.legacy(),
        'fork ' + await forked,
        'require ' + require(path.join(__dirname, 'lib', 'plugin.js')).name
    ]
    await piscina.destroy()
    await pool.terminate()
    await tinypool.destroy()
    child.disconnect()
    console.log(lines.join('\\n'))
}
main()
`,
            'build/lib/Double.js': 'module.exports = (n) => n * 2\n',
            'build/lib/pooled.js': 'require(\'workerpool\').worker({triple: (n) => n * 3})\n',
            'build/lib/legacy.js': 'require(\'node:worker_threads\').parentPort.postMessage(\'legacy\')\n',
            'build/lib/plugin.js': 'module.exports = {name: \'plugin\'}\n',
            'build/child.js': 'process.send(\'child\')\n',
            'workers/predict.js': 'const {parentPort, workerData} = require(\'node:worker_threads\')\nparentPort.postMessage(workerData * 10)\n'
        })
        linkPackages(project, ['piscina', 'workerpool', 'tinypool'])
        const result = await bundleProject({project: project})
        assert.deepStrictEqual(result.warnings, [])
        //The scripts of the application, and the ones of the pools (their workers, the children of the processes)
        for (const script of ['build/child.js', 'build/lib/Double.js', 'build/lib/legacy.js', 'build/lib/plugin.js', 'build/lib/pooled.js', 'workers/predict.js']) assert.ok(result.workers.includes(script), script)
        assert.ok(result.workers.some((script: string): boolean => script.endsWith('piscina/dist/worker.js')))
        //The packages linked from outside of the project are named from their node_modules in the tree
        const workers: string = path.join(result.nativeDirectory!, '.lakutata', 'files')
        assert.ok(existsSync(path.join(workers, 'node_modules', 'piscina', 'dist', 'worker.js')))
        assert.strictEqual(runWithout(project, result.outfile, ['build', 'workers', 'node_modules']), [
            'piscina 4', 'workerpool 6', 'tinypool 6', 'property 50', 'assigned legacy', 'fork child', 'require plugin'
        ].join('\n'))
    })

    it('runs the scripts of an executable started for them (fork()) instead of the application, in the executables of Node.js', async (): Promise<void> => {
        const project: string = path.join(work, 'anywhere')
        const result = await buildExecutable({project: project, outdir: path.join(project, 'executable')})
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: path.join(work, 'anywhere-node')}, timeout: 60000}).toString().trim(), [
            'piscina 4', 'workerpool 6', 'tinypool 6', 'property 50', 'assigned legacy', 'fork child', 'require plugin'
        ].join('\n'))
    })

    it('runs the scripts of an executable started for them (fork()) instead of the application, in the executables of Bun', {skip: !hasBun() && 'Bun is not installed'}, async (): Promise<void> => {
        const project: string = path.join(work, 'anywhere')
        const result = await buildExecutable({project: project, outdir: path.join(project, 'executable-bun'), runtime: 'bun'})
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: path.join(work, 'anywhere-bun')}, timeout: 60000}).toString().trim(), [
            'piscina 4', 'workerpool skipped', 'tinypool 6', 'property 50', 'assigned legacy', 'fork child', 'require plugin'
        ].join('\n'))
    })

    it('copies the files and the directories of data the application reads by their paths, warns of the ones it cannot ship', async (): Promise<void> => {
        const project: string = path.join(work, 'resources')
        //The module reading them is deeper than the bundle (build/config, dist): their paths from it are not the same
        writeProject(project, {
            'package.json': JSON.stringify({name: 'resources', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': 'require(\'./config/loader.js\')\n',
            'build/config/loader.js': `const path = require('node:path')
const fs = require('node:fs')
const schemas = path.resolve(__dirname, '../../schema')
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8'))
const messages = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'locales', \`\${lang}.json\`), 'utf8'))
const project = path.join(__dirname, '..')
const plugins = path.join(__dirname, '..', '..', 'plugins')
const logs = path.join(__dirname, '..', '..', 'logs')
const deep = fs.readFileSync(path.join(schemas, 'nested', 'deep.schema'), 'utf8').trim()
console.log([fs.readdirSync(schemas).sort().join(','), deep, defaults.mode, messages('en').hello, messages('zh').hello, path.basename(logs)].join('\\n'))
`,
            'build/config/defaults.json': JSON.stringify({mode: 'default'}),
            'schema/core.schema': 'core\n',
            'schema/extra.schema': 'extra\n',
            'schema/nested/deep.schema': 'deep\n',
            'locales/en.json': JSON.stringify({hello: 'Hello'}),
            'locales/zh.json': JSON.stringify({hello: '你好'}),
            'locales/readme.txt': 'Not a catalog\n',
            'plugins/a.js': 'module.exports = 1\n'
        })
        const result = await bundleProject({project: project})
        assert.deepStrictEqual(result.files, ['build/config/defaults.json', 'locales/en.json', 'locales/zh.json', 'schema'])
        const files: string = path.join(result.nativeDirectory!, '.lakutata', 'files')
        assert.ok(existsSync(path.join(files, 'schema', 'nested', 'deep.schema')) && !existsSync(path.join(files, 'locales', 'readme.txt')))
        //The directory holding the module, the directory of scripts: warned of; the directory to come: left as it is
        assert.deepStrictEqual(result.warnings.map((warning: string): string => warning.replace(/: the path .*/, '')), ['build/config/loader.js:6', 'build/config/loader.js:7'])
        assert.match(result.warnings[0], /directory holding the module.*lakutata\.resources/)
        assert.match(result.warnings[1], /directory of scripts or of packages/)
        const expected: string = ['core.schema,extra.schema,nested', 'deep', 'default', 'Hello', '你好', 'logs'].join('\n')
        assert.strictEqual(runWithout(project, result.outfile, ['build', 'schema', 'locales', 'plugins']), expected)
        const executable = await buildExecutable({project: project, outdir: path.join(project, 'executable')})
        assert.deepStrictEqual(executable.files, result.files)
        assert.strictEqual(execFileSync(executable.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: path.join(work, 'resources-node')}, timeout: 60000}).toString().trim(), expected)
    })

    it('warns of the scripts bundled with the application and run on their own too', async (): Promise<void> => {
        const project: string = path.join(work, 'twice')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'twice', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const {Worker} = require('node:worker_threads')
const helper = require('./helper.js')
new Worker(require('node:path').join(__dirname, 'helper.js')).once('message', (message) => console.log(helper.name, message))
`,
            'build/helper.js': `module.exports = {name: 'helper'}
const {parentPort} = require('node:worker_threads')
if (parentPort) parentPort.postMessage('in a worker')
`
        })
        const result = await bundleProject({project: project})
        assert.deepStrictEqual(result.warnings.length, 1)
        assert.match(result.warnings[0], /^build\/helper\.js: is bundled with the application and run on its own/)
        assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), 'helper in a worker')
    })

    it('warns of the workers whose scripts it cannot follow, in the modules of the application', async (): Promise<void> => {
        const project: string = path.join(work, 'warned')
        writeProject(project, {
            'package.json': JSON.stringify({name: 'warned', version: '1.0.0', main: 'build/index.js'}),
            'build/index.js': `const {Worker} = require('node:worker_threads')
let script = require('node:path').join(__dirname, 'worker.js')
const file = process.argv[2]
new Worker(file)
new Worker('./worker.js')
new Worker(require('node:path').join(__dirname, 'missing.js'))
new Worker('require("node:worker_threads").parentPort.postMessage(1)', {eval: true})
new Worker(script)
require('pool').run(file)
`,
            'build/worker.js': 'require(\'node:worker_threads\').parentPort.postMessage(1)\n',
            'node_modules/pool/package.json': JSON.stringify({name: 'pool', version: '1.0.0', main: 'index.js'}),
            'node_modules/pool/index.js': 'exports.run = (file) => new (require(\'node:worker_threads\').Worker)(file)\n'
        })
        const result = await bundleProject({project: project})
        assert.ok(existsSync(result.outfile))
        //The path of the variable is followed, whatever starts its worker
        assert.deepStrictEqual(result.workers, ['build/worker.js'])
        assert.deepStrictEqual(result.warnings.map((warning: string): string => warning.replace(/: .*/, '')), ['build/index.js:4', 'build/index.js:5', 'build/index.js:6'])
        assert.match(result.warnings[0], /cannot be followed \(file\)/)
        assert.match(result.warnings[1], /current directory of the process/)
        assert.match(result.warnings[2], /is not found/)
    })

    it('embeds the scripts of the workers in the executables of Node.js, extracted at their first run', async (): Promise<void> => {
        const result = await buildExecutable({project: common, outdir: path.join(common, 'executable')})
        assert.deepStrictEqual(result.workers.length, 7)
        const cache: string = path.join(work, 'cache-node')
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: cache}}).toString().trim(), EXPECTED)
    })

    it('embeds the scripts of the workers in the executables of Bun', {skip: !hasBun() && 'Bun is not installed'}, async (): Promise<void> => {
        const result = await buildExecutable({project: common, outdir: path.join(common, 'executable-bun'), runtime: 'bun'})
        const cache: string = path.join(work, 'cache-bun')
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: '', LAKUTATA_NATIVE_DIR: cache}}).toString().trim(), EXPECTED)
    })
})
