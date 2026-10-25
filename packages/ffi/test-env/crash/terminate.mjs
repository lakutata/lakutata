//Worker threads stopped while they use koffi, over and over. Not a unit test: a check to run again when koffi, Bun or
//Node.js is upgraded. A process that crashes exits with a signal (or 0xC0000005 on Windows).
//   npm run compile && node test-env/crash/terminate.mjs [rounds] [async | sync | threads | starting | loading]
//   bun test-env/crash/terminate.mjs [rounds] [async | sync | threads | starting | loading]
//- async (by default): asynchronous calls in the thread pool, the worker stopped while they run. Bun (1.4.3, 1.4.4)
//  crashes: a null pointer in the completion of the N-API async work during the teardown of the worker. Node.js and
//  Electron do not.
//- sync: synchronous calls only (the control): no crash expected.
//- threads: asynchronous calls in the worker threads of the library (threads: 1), the worker stopped while they run
//  (the threads started, the function bound): no crash expected.
//- starting: the same, the worker stopped while the threads of the library start: they load koffi, then bind the
//  functions.
//- loading: the worker stopped while it imports the package (it loads koffi).
//  starting and loading crash in Node.js and in Bun (koffi 3.3.4): koffi throws when it cannot make its objects in a
//  thread being stopped, and node-addon-api ends the process when the exception cannot be thrown ("FATAL ERROR:
//  Error::ThrowAsJavaScriptException napi_throw"; koffi is not built with NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS).
//  In Node.js, only the loading of koffi was seen to crash; in Bun, the binding of the functions too, where Bun also
//  crashes on its own (a segmentation fault in napi_add_finalizer, 1.4.3).
import {writeSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads'

const PACKAGE = '../../dist/esm/exports/FFI.js'

/**
 * A native sleep of some milliseconds, asynchronous or not: Sleep of kernel32 on Windows, usleep of the C library
 * elsewhere
 * @param loadNativeLibrary
 * @param async
 * @param threads the worker threads of the library
 */
function nativeSleep(loadNativeLibrary, async, threads) {
    if (process.platform === 'win32') return loadNativeLibrary('kernel32', '', {threads: threads}).func('void WINAPI Sleep(DWORD milliseconds)', {async: async})
    const usleep = loadNativeLibrary('c', '', {threads: threads}).func('int usleep(uint32_t microseconds)', {async: async})
    return milliseconds => usleep(Math.round(milliseconds * 1000))
}

/**
 * A worker of the given mode, stopped some milliseconds after its first message
 * @param file
 * @param mode
 * @param delay the milliseconds before it is stopped
 */
function stopWorker(file, mode, delay) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(file, {workerData: {mode: mode}})
        worker.once('message', () => setTimeout(() => worker.terminate().then(resolve, reject), delay()))
        worker.on('error', reject)
    })
}

if (!isMainThread) {
    const mode = workerData.mode
    //The package imported after the first message: the worker is stopped while it loads in the mode loading
    if (mode === 'loading' || mode === 'calibrate') parentPort.postMessage('importing')
    const started = performance.now()
    const {loadNativeLibrary} = await import(PACKAGE)
    if (mode === 'calibrate') {
        parentPort.postMessage(performance.now() - started)
    } else if (mode !== 'loading') {
        const sleep = nativeSleep(loadNativeLibrary, mode !== 'sync', mode === 'threads' || mode === 'starting' ? 1 : 0)
        //The function bound in the thread before the calls the worker is stopped during
        if (mode === 'threads') await sleep(1)
        for (let i = 0; i < 4; i++) {
            const call = sleep(mode === 'sync' ? Math.random() * 2 : Math.random() * 20)
            if (call instanceof Promise) call.catch(() => undefined)
        }
        parentPort.postMessage('started')
    }
} else {
    const rounds = Number(process.argv[2] ?? 50)
    const mode = process.argv[3] ?? 'async'
    const file = fileURLToPath(import.meta.url)
    //How long a worker takes to import the package: the ones of the mode loading are stopped within this time
    let window = 20
    if (mode === 'loading') {
        window = await new Promise((resolve, reject) => {
            const worker = new Worker(file, {workerData: {mode: 'calibrate'}})
            worker.on('message', message => {
                if (typeof message === 'number') worker.terminate().then(() => resolve(message), reject)
            })
            worker.on('error', reject)
        })
    }
    for (let round = 0; round < rounds; round++) {
        await Promise.all(Array.from({length: 4}, () => stopWorker(file, mode, () => Math.random() * window)))
    }
    writeSync(1, `${rounds} rounds of 4 workers stopped (${mode}${mode === 'loading' ? `, within the ${window.toFixed(0)} ms of the import` : ''})\n`)
    process.exit(0)
}
