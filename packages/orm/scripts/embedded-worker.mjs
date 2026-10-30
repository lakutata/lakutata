// The code of the worker thread of mongo-embedded: its entry (built by tsc into dist/vendor/typeorm) bundled with the
// store, mingo, bson and tslib into one script, written as the string that EmbeddedWorkerCode exports. The licenses of
// mingo and bson are kept in it (THIRD_PARTY_NOTICES.md).
import {build} from 'esbuild'
import {rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const directory = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist/vendor/typeorm/driver/mongo-embedded')
const result = await build({
    entryPoints: [path.join(directory, 'EmbeddedWorker.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    //The oldest Node.js the packages run on (NW.js 0.70)
    target: 'node18.10',
    minify: true,
    //The names of the classes are the ones of the errors
    keepNames: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'warning'
})
const code = result.outputFiles[0].text
await writeFile(path.join(directory, 'EmbeddedWorkerCode.js'), `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.embeddedWorkerCode = void 0;\nexports.embeddedWorkerCode = ${JSON.stringify(code)};\n`)
await rm(path.join(directory, 'EmbeddedWorkerCode.js.map'), {force: true})
console.log(`The worker thread of mongo-embedded: ${(code.length / 1024).toFixed(0)} KiB`)
