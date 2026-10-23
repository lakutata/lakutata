//The benchmark of the TURN server: a TURNServer in this process relays a data channel between two connections of the
//engine (engine.mjs in a child process, its two ends relaying only, TURN=…). Both ends relay through this server, so it
//carries each packet twice: from the client of the sender to the allocation of the receiver, then to the receiver.
//The CPU measured is the one of this process only. For reference, libjuice took about 3.9 s of CPU per GiB carried once
//(one end relaying), on the same Apple M4.
//
//   npm run compile && node test-env/bench/turn.mjs [--total 134217728] [--seconds 5] [--idle 0] [--workers 0]
//       [--parallel 1]
//
//--idle allocations of other clients, idle, are made first: the cost of a packet should not grow with them.
//--workers: the worker threads of the server (Linux; elsewhere it serves in the main thread). The CPU measured includes
//theirs. --parallel: the cases run in that many processes at once, each with its two ends, for the system to spread
//their clients among the threads; the numbers are their sums.
//
//WEBRTC_BENCH_DIST: the exports of another build (the absolute path of its dist/esm/exports/WebRTC.js).
import {execFile} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'

const exports = process.env.WEBRTC_BENCH_DIST ? pathToFileURL(path.resolve(process.env.WEBRTC_BENCH_DIST)).href : new URL('../../dist/esm/exports/WebRTC.js', import.meta.url).href
const {TURNServer} = await import(exports)
const {createTurnClient} = await import(new URL('../lib/ice/turn/protocol.js', exports).href)
const {turnWorkers} = await import(new URL('../turn/TURNWorkers.js', exports).href)

const {values: options} = parseArgs({
    options: {
        total: {type: 'string', default: String(128 * 1024 * 1024)},
        seconds: {type: 'string', default: '5'},
        idle: {type: 'string', default: '0'},
        workers: {type: 'string', default: '0'},
        parallel: {type: 'string', default: '1'}
    }
})
const PORT = 34780

const parallel = Number(options.parallel)

/**
 * Run a case of engine.mjs through the server in --parallel processes at once, measuring the CPU and the memory of this
 * process meanwhile
 */
async function relay(test, params) {
    let rss = 0
    //The allocations of each thread made by this case (those of the case before stay until they expire), when they were
    //the most
    let spread = []
    const threads = turnWorkers.get(server)
    const before = threads?.threadAllocations ?? []
    const sampling = setInterval(() => {
        rss = Math.max(rss, process.memoryUsage().rss)
        const now = (threads?.threadAllocations ?? []).map((count, index) => count - before[index])
        if (now.reduce((a, b) => a + b, 0) > spread.reduce((a, b) => a + b, 0)) spread = now
    }, 100)
    const cpu0 = process.cpuUsage()
    const t0 = performance.now()
    const args = [fileURLToPath(new URL('./engine.mjs', import.meta.url)), '--only', test, '--runs', '1', '--params', JSON.stringify(params)]
    const outputs = await Promise.all(Array.from({length: parallel}, () => new Promise((resolve, reject) => execFile(process.execPath, args, {env: {...process.env, TURN: `127.0.0.1:${PORT}:bench:bench`}, maxBuffer: 16 * 1024 * 1024}, (error, out, err) => {
        if (error) return reject(new Error(`${error.message} ${err}`))
        resolve(out)
    }))))
    const {user, system} = process.cpuUsage(cpu0)
    const seconds = (performance.now() - t0) / 1000
    clearInterval(sampling)
    const results = outputs.map((stdout) => JSON.parse(stdout.split('\n').reverse().find((each) => each.startsWith('{'))).result)
    const sum = (key) => results.reduce((total, result) => total + result[key], 0)
    return {result: {MiBps: sum('MiBps'), perSecond: sum('perSecond')}, cpu: (user + system) / 1e6, seconds, rss, spread: spread.length ? `, the allocations of the threads ${spread.join('/')}` : ''}
}

const container = new Container()
let server
const idle = []
try {
    //A user for each idle client: the server limits the allocations of a user
    const count = Number(options.idle)
    const users = Object.fromEntries([['bench', 'bench'], ...Array.from({length: count}, (_, index) => [`idle${index}`, 'idle'])])
    await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: PORT, publicAddress: '127.0.0.1', users, maxAllocations: count + 10 + 2 * parallel, workers: Number(options.workers)})
    for (let index = 0; index < count; index += 50) {
        idle.push(...await Promise.all(Array.from({length: Math.min(50, count - index)}, (_, offset) => createTurnClient({address: ['127.0.0.1', PORT], username: `idle${index + offset}`, password: 'idle'}))))
    }
    server = await container.get('turn')
    if (idle.length) console.log(`${idle.length} idle allocations, ${server.allocations} on the server`)
    const format = (value, digits = 0) => value.toLocaleString('en-US', {maximumFractionDigits: digits})
    const total = Number(options.total)
    const bulk = await relay('bulk', {size: 16384, high: 16384, total})
    const GiB = total * parallel / 2 ** 30
    console.log(`bulk, 16 KiB messages     ${format(bulk.result.MiBps, 1)} MiB/s, the server ${format(bulk.cpu / bulk.seconds * 100, 1)} % of a core, ${format(bulk.cpu / GiB, 1)} CPU s per GiB, ${format(bulk.rss / 2 ** 20)} MiB resident at most${bulk.spread}`)
    const small = await relay('small', {size: 100, high: 16384, duration: Number(options.seconds) * 1000, reliable: true})
    const messages = small.result.perSecond * Number(options.seconds)
    console.log(`100-byte messages         ${format(small.result.perSecond)} a second, the server ${format(small.cpu / small.seconds * 100, 1)} % of a core, ${format(small.cpu / messages * 1e6, 2)} CPU µs per message${small.spread}`)
} finally {
    await Promise.all(idle.map((client) => client.close().catch(() => undefined)))
    await container.destroy()
}
