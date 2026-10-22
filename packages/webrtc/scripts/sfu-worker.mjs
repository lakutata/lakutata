// The code of the worker threads of the media server: their entry (dist/esm/sfu/SFUWorker.js, built by tsc) bundled
// with the engine and @lakutata/core into one script, written as the string that SFUWorkerCode exports in the ESM and
// the CommonJS builds. The threads start from that string (new Worker(code, {eval: true})): no file of the package is
// looked for, whatever bundles the application.
//
// Run: node scripts/sfu-worker.mjs (after build:esm and build:cjs)
import {build} from 'esbuild'
import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const result = await build({
    stdin: {
        contents: 'import {runSFUWorker} from \'./SFUWorker.js\'\nrunSFUWorker()\n',
        resolveDir: path.join(root, 'dist/esm/sfu'),
        sourcefile: 'sfu-worker.js'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: true,
    //The names of the classes are the ones of the errors
    keepNames: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'warning'
})
const code = JSON.stringify(result.outputFiles[0].text)
await writeFile(path.join(root, 'dist/esm/sfu/SFUWorkerCode.js'), `export const sfuWorkerCode = ${code};\n`)
await writeFile(path.join(root, 'dist/cjs/sfu/SFUWorkerCode.js'), `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.sfuWorkerCode = void 0;\nexports.sfuWorkerCode = ${code};\n`)
console.log(`The worker threads of the media server: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KiB`)
