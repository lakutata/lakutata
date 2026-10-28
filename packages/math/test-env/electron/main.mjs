//The tests of the package in the main process of Electron (its Node.js, its event loop): the compiled
//specs run in this process, one after the other, and the process exits with 1 when one fails.
//   npm run build:js && npm run test:electron [-- dist/esm/tests/Formulas.spec.js …]
//Without files, every spec of dist/esm/tests.
import {glob} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {run} from 'node:test'
import {spec} from 'node:test/reporters'
import {app} from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const given = process.argv.slice(2).filter(argument => argument.endsWith('.js'))

/**
 * Run the specs, then exit
 */
async function test() {
    const files = given.length ? given.map(file => path.resolve(root, file)) : (await Array.fromAsync(glob('dist/esm/tests/**/*.spec.js', {cwd: root})))
        .map(file => path.join(root, file))
        .sort()
    const stream = run({files: files, isolation: 'none', timeout: 900000})
    stream.compose(spec).pipe(process.stdout)
    //Run in this process, the tests end when its event loop is empty, which never happens in Electron: once every test
    //begun has ended and none begins for 3 seconds, the run is ended as Node.js would end it
    let begun = 0
    let ended = 0
    let last = Date.now()
    stream.on('test:enqueue', () => {
        begun++
        last = Date.now()
    })
    stream.on('test:complete', () => {
        ended++
        last = Date.now()
    })
    const idle = setInterval(() => {
        if (!begun || ended < begun || Date.now() - last < 3000) return
        clearInterval(idle)
        process.emit('beforeExit', 0)
    }, 500)
    //The summary of the whole run (the ones of the files have their file)
    stream.on('test:summary', summary => {
        if (summary.file !== undefined) return
        //The reporter writes its last lines first
        setTimeout(() => {
            const {tests, passed, failed, skipped} = summary.counts
            console.log(`Electron ${process.versions.electron} (Node.js ${process.versions.node}): ${files.length} files, ${tests} tests, ${passed} passed, ${failed} failed, ${skipped} skipped`)
            app.exit(failed ? 1 : 0)
        }, 500)
    })
}

app.dock?.hide()
//Not awaited at the top: an ES module main is evaluated before the app is ready
app.whenReady().then(test, (error) => {
    console.error(error)
    app.exit(1)
})
