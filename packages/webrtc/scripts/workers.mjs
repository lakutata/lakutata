// The code of the worker threads of the media server, of the TURN server and of the connections: the entry of each
// (dist/esm/sfu/SFUWorker.js, dist/esm/turn/TURNWorker.js and dist/esm/peer/PeerWorker.js, built by tsc) bundled with
// what it uses of the engine and of @lakutata/core into one script, written as the string that SFUWorkerCode,
// TURNWorkerCode or PeerWorkerCode exports in the ESM and the CommonJS builds. The threads start from that string (new
// Worker(code, {eval: true})): no file of the package is looked for, whatever bundles the application.
//
// Run: node scripts/workers.mjs (after build:esm and build:cjs)
import {build} from 'esbuild'
import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const entries = [
    {directory: 'sfu', module: 'SFUWorker', run: 'runSFUWorker', name: 'sfuWorkerCode', description: 'the media server'},
    {directory: 'turn', module: 'TURNWorker', run: 'runTURNWorker', name: 'turnWorkerCode', description: 'the TURN server'},
    {directory: 'peer', module: 'PeerWorker', run: 'runPeerWorker', name: 'peerWorkerCode', description: 'the connections'}
]
for (const entry of entries) {
    const result = await build({
        stdin: {
            contents: `import {${entry.run}} from './${entry.module}.js'\n${entry.run}()\n`,
            resolveDir: path.join(root, 'dist/esm', entry.directory),
            sourcefile: `${entry.directory}-worker.js`
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        //Not the syntax: Bun (1.4) evaluating it in a worker thread fails in the constructors of derived classes
        //("super() must be called in derived constructor before accessing this"), the same code loaded from a file does
        //not
        minifyWhitespace: true,
        minifyIdentifiers: true,
        //The names of the classes are the ones of the errors
        keepNames: true,
        legalComments: 'inline',
        write: false,
        logLevel: 'warning'
    })
    const code = JSON.stringify(result.outputFiles[0].text)
    await writeFile(path.join(root, 'dist/esm', entry.directory, `${entry.module}Code.js`), `export const ${entry.name} = ${code};\n`)
    await writeFile(path.join(root, 'dist/cjs', entry.directory, `${entry.module}Code.js`), `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.${entry.name} = void 0;\nexports.${entry.name} = ${code};\n`)
    console.log(`The worker threads of ${entry.description}: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KiB`)
}
