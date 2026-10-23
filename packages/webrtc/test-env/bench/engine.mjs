//The benchmark of the engine: data channels and RTP between two connections, each end in its own process (engine-end.mjs).
//Each case runs --runs times; with more than one run the first is dropped (the warm-up of the JIT) and the others are
//averaged. One JSON line per case.
//
//   npm run compile && node test-env/bench/engine.mjs [--only bulk,small,conns,rtp] [--runs 3] [--quick]
//                                                     [--runtime node|bun] [--out results.json]
//   One case of one test: node test-env/bench/engine.mjs --only conns --params '{"n":200,"idle":3000}'
//
//Tests: bulk (reliable, 1/16/64 KiB messages, 32 MiB), small (100-byte messages for 10 s, reliable and unordered with
//maxRetransmits 0), conns (50/100/200 connections: setup time, RSS per connection, idle CPU), rtp (1200-byte RTP at
//2k/10k/30k packets/s). Bulk and small run at two send buffer limits, 16 KiB and 1 MiB. targets.mjs runs the cases of
//the performance targets and compares them. See engine-end.mjs for WEBRTC_BENCH_DIST and TURN.
import {fork} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {parseArgs} from 'node:util'

const {values: options} = parseArgs({
    options: {
        only: {type: 'string', default: 'bulk,small,conns,rtp'},
        runs: {type: 'string', default: '3'},
        quick: {type: 'boolean', default: false},
        runtime: {type: 'string', default: 'node'},
        out: {type: 'string'},
        params: {type: 'string'}
    }
})
const MiB = 1024 * 1024
const quick = options.quick
//high: the send buffer limit of the sender, which waits for the low event (at a quarter of it) above it
const highs = [16 * 1024, MiB]
const cases = {
    bulk: [1024, 16384, 65536].flatMap((size) => highs.map((high) => ({size, high, total: (quick ? 4 : 32) * MiB}))),
    small: [true, false].flatMap((reliable) => highs.map((high) => ({size: 100, high, duration: quick ? 2000 : 10000, reliable}))),
    conns: (quick ? [10] : [50, 100, 200]).map((n) => ({n, idle: quick ? 3000 : 15000})),
    rtp: (quick ? [2000] : [2000, 10000, 30000]).map((rate) => ({rate, duration: quick ? 2000 : 10000}))
}
if (options.params) cases[options.only] = [JSON.parse(options.params)]

function start() {
    const bun = options.runtime === 'bun'
    return fork(new URL('./engine-end.mjs', import.meta.url), [], {
        execPath: bun ? 'bun' : process.execPath,
        //PROF=<directory> writes a CPU profile of each end there
        execArgv: bun ? [] : ['--expose-gc', ...(process.env.PROF ? ['--cpu-prof', `--cpu-prof-dir=${process.env.PROF}`, '--cpu-prof-interval=200'] : [])],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    })
}

/**
 * The next message of a type from a child, or a timeout
 */
function next(child, type, timeout = 180000) {
    const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeout)
        const listener = (message) => {
            if (message.type !== type) return
            clearTimeout(timer)
            child.off('message', listener)
            resolve(message)
        }
        child.on('message', listener)
    })
    //Some are awaited only after another one: a timeout before that is not an unhandled rejection
    promise.catch(() => undefined)
    return promise
}

async function pair(test, params) {
    const offerer = start()
    const answerer = start()
    try {
        await Promise.all([next(offerer, 'ready'), next(answerer, 'ready')])
        offerer.on('message', (message) => message.type === 'signal' && answerer.send({cmd: 'signal', kind: 'offer', id: message.id, sdp: message.sdp}))
        answerer.on('message', (message) => message.type === 'signal' && offerer.send({cmd: 'signal', kind: 'answer', id: message.id, sdp: message.sdp}))
        const run = (child, role) => child.send({cmd: 'run', test, role, params})
        if (test === 'bulk') {
            const started = next(offerer, 'started')
            const received = next(answerer, 'result')
            run(answerer, 'answerer')
            run(offerer, 'offerer')
            const {t0} = await started
            const receiver = await received
            const sent = next(offerer, 'result')
            offerer.send({cmd: 'finish'})
            const sender = await sent
            const seconds = (receiver.t1 - t0) / 1000
            const GiB = params.total / (1024 * MiB)
            return {MiBps: params.total / MiB / seconds, senderCpuPerGiB: sender.cpu / GiB, receiverCpuPerGiB: receiver.cpu / GiB, rssMiB: Math.max(sender.rssMax, receiver.rssMax) / MiB}
        }
        if (test === 'small' || test === 'rtp') {
            const sent = next(offerer, 'result', params.duration + 60000)
            run(answerer, 'answerer')
            run(offerer, 'offerer')
            const sender = await sent
            const received = next(answerer, 'result')
            answerer.send({cmd: 'finish'})
            const receiver = await received
            const count = receiver.received
            //A backlog drains after the window, a stalled receiver gets a short burst: the window is the lower bound
            const seconds = Math.max(receiver.last - receiver.first, params.duration) / 1000
            return {
                perSecond: count / seconds,
                delivered: count / sender.sent,
                senderCpuPercent: sender.cpu / (params.duration / 1000) * 100,
                receiverCpuPercent: receiver.cpu / seconds * 100,
                cpuMicrosPerItem: count ? (sender.cpu + receiver.cpu) / count * 1e6 : 0
            }
        }
        if (test === 'conns') {
            const timeout = params.timeout ?? 300000
            const opened = next(offerer, 'opened', timeout)
            const offererResult = next(offerer, 'result', timeout + params.idle)
            const answererResult = next(answerer, 'result', timeout + params.idle)
            run(answerer, 'answerer')
            run(offerer, 'offerer')
            try {
                await opened
            } catch (error) {
                //Where it stands: the peers of each end, counted by state
                const statuses = await Promise.all([offerer, answerer].map((child) => {
                    const reply = next(child, 'status', 5000)
                    child.send({cmd: 'status'})
                    return reply.catch(() => 'no answer')
                }))
                console.error(`conns ${JSON.stringify(params)} not all opened; offerer ${JSON.stringify(statuses[0])}; answerer ${JSON.stringify(statuses[1])}`)
                throw error
            }
            answerer.send({cmd: 'opened'})
            const a = await offererResult
            const b = await answererResult
            return {setupMs: a.setup, rssKiBPerConnOfferer: a.rssPerConn / 1024, rssKiBPerConnAnswerer: b.rssPerConn / 1024, idleCpuPercent: (a.idleCpu + b.idleCpu) * 100, answererOpen: b.open}
        }
        throw new Error(`unknown test ${test}`)
    } finally {
        for (const child of [offerer, answerer]) {
            if (child.connected) child.send({cmd: 'exit'})
            setTimeout(() => child.kill('SIGKILL'), 3000).unref()
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
}

const average = (results) => Object.fromEntries(Object.keys(results[0]).map((key) => [key, results.reduce((sum, result) => sum + result[key], 0) / results.length]))
const runs = Number(options.runs)
const report = []
for (const test of options.only.split(',')) {
    for (const params of cases[test]) {
        const results = []
        for (let i = 0; i < runs; i++) {
            try {
                results.push(await pair(test, params))
            } catch (error) {
                console.error(`${test} ${JSON.stringify(params)} run ${i + 1}: ${error.message}`)
            }
        }
        const kept = results.length > 1 ? results.slice(1) : results
        const entry = {test, params, runtime: options.runtime, runs: results.length, result: kept.length ? average(kept) : null, all: results}
        report.push(entry)
        console.log(JSON.stringify({test, params, result: entry.result}))
    }
}
if (options.out) writeFileSync(options.out, JSON.stringify(report, null, 2))
