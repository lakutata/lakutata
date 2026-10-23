//The performance targets of the engine, measured: each case of engine.mjs behind a target runs, and its result is printed
//next to the target. Exits with 1 when a target is missed, so a release can be checked with one command (about a
//minute):
//
//   npm run compile && node test-env/bench/targets.mjs [--runtime node|bun]
//
//The targets, set against libdatachannel (node-datachannel) measured on the same machine, an Apple M4 with Node.js 24:
//- bulk transfer of one connection, 16 and 64 KiB messages: 70 MiB/s or more, 40 s of CPU per GiB or less (both ends);
//- 100-byte messages of one connection: 50,000 a second or more;
//- a send buffer limit of 1 MiB about as fast as one of 16 KiB: taken here as 80% of it or more, for 1 KiB messages
//  (which werift stalled on) and 100-byte messages;
//- 200 connections set up in 2 seconds or less.
import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

const {values: options} = parseArgs({options: {runtime: {type: 'string', default: 'node'}}})

/**
 * The result of one case of engine.mjs (the average of its runs but the first)
 */
function measure(test, params, runs) {
    const args = [fileURLToPath(new URL('./engine.mjs', import.meta.url)), '--only', test, '--runs', String(runs), '--runtime', options.runtime, '--params', JSON.stringify(params)]
    return new Promise((resolve, reject) => execFile(process.execPath, args, {maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
        const line = stdout.split('\n').reverse().find((each) => each.startsWith('{'))
        const result = line ? JSON.parse(line).result : null
        if (result) return resolve(result)
        reject(new Error(`${test} ${JSON.stringify(params)} gave no result: ${error?.message ?? ''} ${stderr.trim()}`))
    }))
}

const MiB = 1024 * 1024
const rows = []
const row = (name, value, target, met) => rows.push({name, value, target, met})
const round = (value, digits = 1) => value.toLocaleString('en-US', {maximumFractionDigits: digits})

for (const size of [16384, 65536]) {
    const result = await measure('bulk', {size, high: 16384, total: 32 * MiB}, 5)
    const cpu = result.senderCpuPerGiB + result.receiverCpuPerGiB
    row(`bulk, ${size / 1024} KiB messages: MiB/s`, round(result.MiBps), '>= 70', result.MiBps >= 70)
    row(`bulk, ${size / 1024} KiB messages: CPU s per GiB`, round(cpu), '<= 40', cpu <= 40)
}
const small = await measure('small', {size: 100, high: 16384, duration: 5000, reliable: true}, 2)
row('100-byte messages a second', round(small.perSecond, 0), '>= 50,000', small.perSecond >= 50000)
const smallLarge = await measure('small', {size: 100, high: MiB, duration: 5000, reliable: true}, 2)
row('100-byte messages, 1 MiB buffer / 16 KiB buffer', round(smallLarge.perSecond / small.perSecond, 2), '>= 0.8', smallLarge.perSecond >= 0.8 * small.perSecond)
const kib = await measure('bulk', {size: 1024, high: 16384, total: 8 * MiB}, 2)
const kibLarge = await measure('bulk', {size: 1024, high: MiB, total: 8 * MiB}, 2)
row('bulk, 1 KiB messages, 16 KiB buffer: MiB/s', round(kib.MiBps), '', true)
row('bulk, 1 KiB messages, 1 MiB buffer / 16 KiB buffer', round(kibLarge.MiBps / kib.MiBps, 2), '>= 0.8', kibLarge.MiBps >= 0.8 * kib.MiBps)
const conns = await measure('conns', {n: 200, idle: 2000, timeout: 120000}, 2)
row('200 connections set up, ms', round(conns.setupMs, 0), '<= 2,000', conns.setupMs <= 2000)

const width = Math.max(...rows.map((each) => each.name.length))
for (const each of rows) console.log(`${each.name.padEnd(width)}  ${each.value.padStart(9)}  ${each.target.padEnd(9)}  ${each.target ? (each.met ? 'met' : 'MISSED') : ''}`)
process.exitCode = rows.every((each) => each.met) ? 0 : 1
