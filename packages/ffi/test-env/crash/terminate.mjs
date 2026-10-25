//Worker threads stopped while asynchronous native calls run in them, over and over: Bun (1.4.3, 1.4.4) crashes (a null
//pointer in the completion of the N-API async work during the teardown of the worker); Node.js and Electron do not. Not
//a unit test: a check to run again when koffi or Bun is upgraded. A process that crashes exits with a signal (or
//0xC0000005 on Windows).
//   npm run compile && node test-env/crash/terminate.mjs [rounds] [sync]
//   bun test-env/crash/terminate.mjs [rounds] [sync]
//With "sync", the workers make synchronous calls only (the control: no crash expected anywhere).
import {writeSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads'
import {loadNativeLibrary} from '../../dist/esm/exports/FFI.js'

/**
 * A native sleep of some milliseconds, asynchronous or not: Sleep of kernel32 on Windows, usleep of the C library elsewhere
 * @param async
 */
function nativeSleep(async) {
    if (process.platform === 'win32') return loadNativeLibrary('kernel32').func('void WINAPI Sleep(DWORD milliseconds)', {async: async})
    const usleep = loadNativeLibrary('c').func('int usleep(uint32_t microseconds)', {async: async})
    return milliseconds => usleep(Math.round(milliseconds * 1000))
}

if (!isMainThread) {
    const sleep = nativeSleep(!workerData.sync)
    for (let i = 0; i < 4; i++) {
        const call = sleep(workerData.sync ? Math.random() * 2 : Math.random() * 20)
        if (call instanceof Promise) call.catch(() => undefined)
    }
    parentPort.postMessage('started')
} else {
    const rounds = Number(process.argv[2] ?? 50)
    const sync = process.argv[3] === 'sync'
    const file = fileURLToPath(import.meta.url)
    for (let round = 0; round < rounds; round++) {
        await Promise.all(Array.from({length: 4}, () => new Promise((resolve, reject) => {
            const worker = new Worker(file, {workerData: {sync: sync}})
            worker.on('message', () => setTimeout(() => worker.terminate().then(resolve, reject), Math.random() * 20))
            worker.on('error', reject)
        })))
    }
    writeSync(1, `${rounds} rounds of 4 workers stopped${sync ? ' (synchronous calls only)' : ' during asynchronous calls'}\n`)
    process.exit(0)
}
