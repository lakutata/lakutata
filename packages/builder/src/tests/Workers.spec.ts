import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs'
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

describe('The scripts of the workers of a bundle', (): void => {

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
        const workers: string = path.join(result.nativeDirectory!, '.lakutata', 'workers')
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
        assert.deepStrictEqual(result.workers, [])
        assert.deepStrictEqual(result.warnings.map((warning: string): string => warning.replace(/: .*/, '')), ['build/index.js:4', 'build/index.js:5', 'build/index.js:6', 'build/index.js:8'])
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
