// The code of the worker threads of the libraries: the entry (dist/esm/lib/thread/NativeWorker.js, built by tsc) bundled
// with what it uses of the package into one script, written as the string that NativeWorkerCode exports in the ESM and
// the CommonJS builds; the threads start from that string (new Worker(code, {eval: true})), whatever bundles the
// application. koffi is loaded by its path, resolved by the thread of the library with the require of the package
// (PackageRequire, written here for each build: createRequire(import.meta.url) in the ES modules, which the bundler of
// lakutata makes the require of the bundle), and @lakutata/core is replaced by the base of the exceptions.
//
// Run: node scripts/worker.mjs (after build:esm and build:cjs)
import {build} from 'esbuild'
import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const shims = path.join(root, 'scripts', 'shims')
const result = await build({
    stdin: {
        contents: "import {runNativeWorker} from './NativeWorker.js'\nrunNativeWorker()\n",
        resolveDir: path.join(root, 'dist/esm/lib/thread'),
        sourcefile: 'native-worker.js'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    //koffi, loaded by its path before the bundle runs; a require when the code is evaluated as an ES module (the threads
    //take the type of the inputs of the process: --input-type=module); the base of the exceptions for @lakutata/core
    banner: {js: "var require=typeof require==='function'?require:process.getBuiltinModule('node:module').createRequire(process.cwd()+'/');globalThis[Symbol.for('lakutata.ffi.koffi')]=require(require('node:worker_threads').workerData.koffi);"},
    alias: {'koffi': path.join(shims, 'koffi.cjs'), '@lakutata/core': path.join(shims, 'core.mjs')},
    //Not the syntax: Bun (1.4) evaluating it in a worker thread fails in the constructors of derived classes
    minifyWhitespace: true,
    minifyIdentifiers: true,
    //The names of the classes are the ones of the errors
    keepNames: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'warning'
})
const text = result.outputFiles[0].text
//The worker must never require koffi by its name: in a bundle, it would not be found
if (/require\(\s*["']koffi["']\s*\)/.test(text)) throw new Error('The code of the worker threads requires koffi by its name')
const code = JSON.stringify(text)
await writeFile(path.join(root, 'dist/esm/lib/thread/NativeWorkerCode.js'), `export const nativeWorkerCode = ${code};\n`)
await writeFile(path.join(root, 'dist/cjs/lib/thread/NativeWorkerCode.js'), `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.nativeWorkerCode = void 0;\nexports.nativeWorkerCode = ${code};\n`)
await writeFile(path.join(root, 'dist/esm/lib/thread/PackageRequire.js'), "import {createRequire} from 'node:module';\nexport const packageRequire = createRequire(import.meta.url);\n")
await writeFile(path.join(root, 'dist/cjs/lib/thread/PackageRequire.js'), `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.packageRequire = void 0;\nexports.packageRequire = require;\n`)
console.log(`The worker threads of the libraries: ${(text.length / 1024).toFixed(0)} KiB`)
