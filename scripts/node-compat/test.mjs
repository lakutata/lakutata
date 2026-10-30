// The unit tests of the packages, built already (npm run build, on the Node.js of the repository), run by another
// node program: the oldest ones the packages run on (Node.js 18.10, 19.3, 18.20). Each package runs the files of its
// test:unit script (the globs expanded here, the older test runners do not), with the options of it the node program
// has (each probed: --test-timeout, --test-concurrency, --test-reporter, --import, else --experimental-loader).
// --test-force-exit is not given: it ends a run before the tests some files declare late; a run that does not end is
// stopped at the time limit (--timeout, in seconds). The files written for a newer test runner than the one of the node program (probed the same
// way) are listed, not run.
//
// Run: node scripts/node-compat/test.mjs --node <node program> [--package core]... [--skip-file <file>]...
// The node program is also read from NODE_COMPAT (nvm: NODE_COMPAT=$(nvm which 18.10.0))

import {spawnSync, spawn} from 'node:child_process'
import {existsSync, globSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PACKAGES = path.join(ROOT, 'packages')

const {values: args} = parseArgs({
    options: {
        node: {type: 'string', default: process.env.NODE_COMPAT},
        package: {type: 'string', multiple: true},
        'skip-file': {type: 'string', multiple: true, default: []},
        timeout: {type: 'string', default: '900'}
    }
})
if (!args.node) {
    console.error('The node program running the tests: --node <path> or NODE_COMPAT (nvm: NODE_COMPAT=$(nvm which 18.10.0))')
    process.exit(2)
}
const NODE = path.resolve(args.node)
const VERSION = spawnSync(NODE, ['-p', 'process.version'], {encoding: 'utf8'}).stdout.trim()

/**
 * Whether the node program runs with an option
 * @param option
 */
function accepts(...option) {
    return spawnSync(NODE, [...option, '-e', '0'], {encoding: 'utf8'}).status === 0
}

/**
 * Whether the test runner of the node program passes a test file
 * @param source
 */
function passes(source) {
    const directory = mkdtempSync(path.join(tmpdir(), 'node-compat-'))
    try {
        const file = path.join(directory, 'probe.test.mjs')
        writeFileSync(file, source)
        return spawnSync(NODE, ['--test', file], {encoding: 'utf8', timeout: 30000}).status === 0
    } finally {
        rmSync(directory, {recursive: true, force: true})
    }
}

const OPTIONS = {
    timeout: accepts('--test-timeout=1000'),
    concurrency: accepts('--test-concurrency=1'),
    reporter: accepts('--test-reporter=spec'),
    import: accepts('--import', 'data:text/javascript,0')
}

/**
 * The ways of writing tests a test runner may not know, how to find them in a test file, and the probe of each
 */
const RUNNER = [
    {
        name: 'tests declared by an awaited describe whose function awaits its tests',
        pattern: /\bawait describe\(/,
        works: passes("import {describe, it} from 'node:test'\nawait describe('suite', async () => {\n    await it('test', () => {})\n})\n")
    },
    {
        name: 'tests whose function takes the context of the test (an older runner takes it for a callback)',
        pattern: /\bit\([^\n]*,\s*async \(\w+\)(: Promise<void>)? =>/,
        works: passes("import {describe, it} from 'node:test'\ndescribe('suite', () => {\n    it('test', async (t) => {})\n})\n")
    }
]

/**
 * The files and the options of the test:unit script of a package
 * @param directory
 */
function unitTests(directory) {
    const script = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).scripts?.['test:unit']
    if (!script) return undefined
    const command = script.split('&&').map(part => part.trim()).find(part => part.startsWith('node '))
    const globs = [...command.matchAll(/"([^"]+)"/g)].map(match => match[1])
    const imports = [...command.matchAll(/--import[= ](\S+)/g)].map(match => match[1])
    const timeout = command.match(/--test-timeout=(\d+)/)?.[1]
    const concurrency = command.match(/--test-concurrency=(\d+)/)?.[1]
    const files = [...new Set(globs.flatMap(glob => globSync(glob, {cwd: directory})))].sort()
    return {files, imports, timeout, concurrency}
}

/**
 * Run the tests of a package: the summary of the runner, read from its spec or TAP output
 * @param name
 * @param directory
 * @param tests
 */
function run(name, directory, tests) {
    const skipped = []
    const files = tests.files.filter(file => {
        if (args['skip-file'].some(skip => file.endsWith(skip))) {
            skipped.push(`${file} (--skip-file)`)
            return false
        }
        const source = readFileSync(path.join(directory, file), 'utf8')
        const unknown = RUNNER.find(way => !way.works && way.pattern.test(source))
        if (unknown) skipped.push(`${file} (the test runner of ${VERSION} does not run ${unknown.name})`)
        return !unknown
    })
    const options = [
        ...tests.imports.flatMap(module => OPTIONS.import ? ['--import', module] : ['--experimental-loader', module]),
        '--test',
        ...OPTIONS.reporter ? ['--test-reporter=spec'] : [],
        ...tests.timeout && OPTIONS.timeout ? [`--test-timeout=${tests.timeout}`] : [],
        ...tests.concurrency && OPTIONS.concurrency ? [`--test-concurrency=${tests.concurrency}`] : []
    ]
    return new Promise(resolve => {
        if (!files.length) return resolve({name, code: 0, summary: {}, skipped, output: ''})
        //The PATH of the scripts of npm: the programs of the packages (bun) found by the tests
        const bins = [path.join(directory, 'node_modules', '.bin'), path.join(ROOT, 'node_modules', '.bin')]
        const env = {...process.env, PATH: [...bins, process.env.PATH].join(path.delimiter)}
        //A group of its own (POSIX): the processes of the test files are stopped with the runner
        const group = process.platform !== 'win32'
        const child = spawn(NODE, [...options, ...files], {cwd: directory, env: env, stdio: ['ignore', 'pipe', 'pipe'], detached: group})
        let output = ''
        child.stdout.on('data', chunk => output += chunk)
        child.stderr.on('data', chunk => output += chunk)
        //A run whose handles stay open never ends: it is stopped at the time limit
        const timer = setTimeout(() => {
            output += `\nnode-compat: stopped after ${args.timeout} seconds\n`
            try {
                if (group) process.kill(-child.pid, 'SIGKILL')
                else child.kill('SIGKILL')
            } catch {
                //Ended meanwhile
            }
        }, Number(args.timeout) * 1000)
        child.on('close', code => {
            clearTimeout(timer)
            const summary = {}
            for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) {
                const match = output.match(new RegExp(`^(?:ℹ|#) ${key} (\\d+)$`, 'm'))
                if (match) summary[key] = Number(match[1])
            }
            resolve({name, code: code ?? 1, summary, skipped, output})
        })
    })
}

const names = args.package ?? readdirSync(PACKAGES).filter(name => !name.startsWith('template') && existsSync(path.join(PACKAGES, name, 'package.json'))).sort()
console.log(`node-compat: the unit tests on Node.js ${VERSION} (${NODE})`)
console.log(`  options: ${Object.entries(OPTIONS).map(([option, has]) => `${option} ${has ? 'yes' : 'no'}`).join(', ')}`)
for (const way of RUNNER.filter(way => !way.works)) console.log(`  the test runner does not run ${way.name}`)
const failed = []
for (const name of names) {
    const directory = path.join(PACKAGES, name)
    const tests = unitTests(directory)
    if (!tests) continue
    if (!tests.files.length) {
        console.log(`${name}: no built test (npm run build first)`)
        failed.push(name)
        continue
    }
    const result = await run(name, directory, tests)
    const {tests: count = 0, pass = 0, fail = 0, cancelled = 0, skipped = 0} = result.summary
    console.log(`${name}: ${result.code === 0 ? 'passed' : `failed (exit ${result.code})`}, tests ${count}, pass ${pass}, fail ${fail}, cancelled ${cancelled}, skipped ${skipped}${result.skipped.length ? `, ${result.skipped.length} file(s) not run` : ''}`)
    for (const file of result.skipped) console.log(`    not run: ${file}`)
    if (result.code !== 0) {
        failed.push(name)
        const failures = result.output.split('\n').filter(line => /^\s*(✖|not ok)/.test(line)).slice(0, 20)
        for (const line of failures) console.log(`    ${line.trim()}`)
    }
}
if (failed.length) {
    console.log(`node-compat: failed on Node.js ${VERSION}: ${failed.join(', ')}`)
    process.exit(1)
}
console.log(`node-compat: the unit tests pass on Node.js ${VERSION}`)
