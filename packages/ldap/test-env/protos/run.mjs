//Replay the PROTOS LDAPv3 test suite (c06-ldapv3 of OUSPG, the University of Oulu: malformed BER encodings and
//malformed search requests, one TCP connection per case) against the engine with a memory backend and the LDAPServer
//component with a directory backend on SQLite, each in a process of its own (server.mjs). The captures of the suite are
//downloaded from the sample captures of Wireshark and checked by their SHA-256; the bytes each connection sent are
//replayed as they are. A server fails a set when it exits, writes to stderr, emits an error, stops answering a valid
//bind and search (or answers in more than a second), keeps a connection open for a message longer than it takes, or
//keeps connections or memory once the cases are done. Build the package first.
//
//   node test-env/protos/run.mjs [--servers engine,component] [--sets enc,app] [--cases 0-199] [--concurrency 16]
//                                [--dir <captures>] [--out <results.json>] [--kill-after <cases>]
import {fork} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {connect} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {connectLDAP} from '../../dist/esm/exports/LDAP.js'

const here = dirname(fileURLToPath(import.meta.url))
const CAPTURES = 'https://wiki.wireshark.org/uploads/__moin_import__/attachments/SampleCaptures'
const SETS = {
    enc: {file: 'c06-ldapv3-enc-r1.pcap', sha256: 'f93b9bbd9a9c45118246062e55b60b4a05f7656e44dc83d893932832ad0254d2', title: 'the encoding set'},
    app: {file: 'c06-ldapv3-app-r1.pcap', sha256: '85413123510c6a7e0cf4d11b78e234e168e532dc111629e654a77fd93f5c8038', title: 'the application set'}
}
//The limit of a message before a bind, as the server's defaults
const ANONYMOUS_MESSAGE_SIZE = 256 * 1024
//A case ends when the server closes, else when it has said nothing for IDLE milliseconds, at most CAP milliseconds
const IDLE = 500
const CAP = 3000
const PROBE_EVERY = 100
const PROBE_LIMIT = 1000
const SLOW = 1000
const HEAP_LIMIT = 50 * 1024 * 1024

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, list) => item.startsWith('--') ? [...pairs, [item.slice(2), list[index + 1]]] : pairs, []))
const servers = (options.servers ?? 'engine,component').split(',')
const sets = (options.sets ?? 'enc,app').split(',')
const concurrency = Number(options.concurrency ?? 16)
const work = mkdtempSync(join(tmpdir(), 'lakutata-protos-'))
const directory = options.dir ?? work

/**
 * A capture, downloaded unless it is in the directory, checked by its SHA-256
 */
async function capture(set) {
    const path = join(directory, set.file)
    if (!existsSync(path)) {
        const response = await fetch(`${CAPTURES}/${set.file}.gz`)
        if (!response.ok) throw new Error(`${set.file}.gz: HTTP ${response.status}`)
        writeFileSync(path, gunzipSync(Buffer.from(await response.arrayBuffer())))
    }
    const data = readFileSync(path)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== set.sha256) throw new Error(`${set.file}: SHA-256 ${digest}, not ${set.sha256}`)
    return data
}

/**
 * The bytes each connection to port 389 sent, in the order of the capture (libpcap, Ethernet, IPv4, TCP): the segments
 * by their sequence numbers, retransmissions dropped
 */
function cases(data) {
    if (data.readUInt32LE(0) !== 0xa1b2c3d4 || data.readUInt32LE(20) !== 1) throw new Error('Not a little-endian pcap of Ethernet frames')
    const streams = new Map()
    const order = []
    for (let offset = 24; offset + 16 <= data.length;) {
        const captured = data.readUInt32LE(offset + 8)
        const frame = data.subarray(offset + 16, offset + 16 + captured)
        offset += 16 + captured
        if (frame.readUInt16BE(12) !== 0x0800 || frame[14 + 9] !== 6) continue
        const ip = frame.subarray(14)
        const tcp = ip.subarray((ip[0] & 0x0f) * 4, ip.readUInt16BE(2))
        if (tcp.readUInt16BE(2) !== 389) continue
        const client = `${ip.subarray(12, 16).join('.')}:${tcp.readUInt16BE(0)}`
        const payload = tcp.subarray((tcp[12] >> 4) * 4)
        let stream = streams.get(client)
        //A SYN starts a connection; a port used again starts another
        if ((tcp[13] & 0x02) && (!stream || stream.size > 0)) {
            stream = new Map()
            streams.set(client, stream)
            order.push(stream)
        }
        if (stream && payload.length > 0 && !stream.has(tcp.readUInt32BE(4))) stream.set(tcp.readUInt32BE(4), Buffer.from(payload))
    }
    return order.map((stream) => {
        const parts = []
        let next
        for (const [seq, payload] of [...stream.entries()].sort(([a], [b]) => a - b)) {
            if (next === undefined || seq >= next) parts.push(payload)
            else if (seq + payload.length > next) parts.push(payload.subarray(next - seq))
            next = Math.max(next ?? 0, seq + payload.length)
        }
        return Buffer.concat(parts)
    })
}

/**
 * The length a message says it has, its header included: undefined for one that is not a SEQUENCE, Infinity for the
 * indefinite form and for more than four bytes of length
 */
function declared(bytes) {
    if (bytes.length < 2 || bytes[0] !== 0x30) return undefined
    if (bytes[1] < 0x80) return 2 + bytes[1]
    const count = bytes[1] & 0x7f
    if (count === 0 || count > 4) return Infinity
    if (bytes.length < 2 + count) return Infinity
    return 2 + count + bytes.readUIntBE(2, count)
}

const OPERATIONS = {0x61: 'bindResponse', 0x64: 'searchResEntry', 0x65: 'searchResDone', 0x67: 'modifyResponse', 0x69: 'addResponse', 0x6b: 'delResponse', 0x6d: 'modDNResponse', 0x6f: 'compareResponse', 0x73: 'searchResRef', 0x78: 'extendedResponse', 0x79: 'intermediateResponse'}

/**
 * The messages of the server, by an independent reading of their BER: the operation, and the result code of a result
 */
function responses(bytes) {
    const messages = []
    const length = (offset) => {
        if (bytes[offset] < 0x80) return [bytes[offset], 1]
        const count = bytes[offset] & 0x7f
        return [bytes.readUIntBE(offset + 1, count), 1 + count]
    }
    for (let offset = 0; offset < bytes.length;) {
        if (bytes[offset] !== 0x30) return [...messages, 'garbage']
        const [size, sizeBytes] = length(offset + 1)
        const content = offset + 1 + sizeBytes
        if (content + size > bytes.length) return [...messages, 'truncated']
        const [idSize, idBytes] = length(content + 1)
        const id = bytes.readUIntBE(content + 1 + idBytes, Math.max(1, idSize))
        const op = content + 1 + idBytes + idSize
        const name = OPERATIONS[bytes[op]] ?? `0x${bytes[op].toString(16)}`
        const [, opBytes] = length(op + 1)
        const result = bytes[op + 1 + opBytes] === 0x0a ? bytes[op + 1 + opBytes + 2] : undefined
        messages.push(id === 0 && name === 'extendedResponse' ? `noticeOfDisconnection(${result})` : result === undefined ? name : `${name}(${result})`)
        offset = content + size
    }
    return messages
}

/**
 * Send the bytes of a case on a connection of its own, and see what the server does
 */
function replay(port, bytes) {
    return new Promise((resolve) => {
        const started = performance.now()
        const chunks = []
        let first
        let closed = false
        let error
        let idle
        let done = false
        const socket = connect({host: '127.0.0.1', port: port})
        const finish = () => {
            if (done) return
            done = true
            clearTimeout(idle)
            clearTimeout(cap)
            socket.destroy()
            const received = Buffer.concat(chunks)
            resolve({first: first, closed: closed, error: error, time: performance.now() - started, received: received})
        }
        const arm = () => {
            clearTimeout(idle)
            idle = setTimeout(finish, IDLE)
        }
        const cap = setTimeout(finish, CAP)
        socket.on('connect', () => {
            socket.write(bytes, () => undefined)
            arm()
        })
        socket.on('data', (chunk) => {
            first ??= performance.now() - started
            chunks.push(chunk)
            arm()
        })
        socket.on('end', () => {
            closed = true
            finish()
        })
        socket.on('error', (reason) => {
            closed = true
            error = reason.code
            finish()
        })
    })
}

/**
 * What a case came to, as a class: the server's messages and whether it closed; a connection left open after nothing
 * was answered by what the message says of its length
 */
function outcome(bytes, result) {
    const messages = responses(result.received)
    const said = [...new Set(messages)].join(' ')
    if (result.closed) return {kind: said ? `${said}, closed` : `closed${result.error ? ` (${result.error})` : ''}`}
    if (said) return {kind: `${said}, left open`}
    const length = declared(bytes)
    if (length === undefined) return {kind: 'nothing said, left open: not a SEQUENCE', failure: 'a message that is not a SEQUENCE left open'}
    if (length > ANONYMOUS_MESSAGE_SIZE) return {kind: 'nothing said, left open: longer than the limit', failure: `a message of ${length} bytes left open, more than ${ANONYMOUS_MESSAGE_SIZE}`}
    if (length > bytes.length) return {kind: 'nothing said, left open: waiting for the rest of the message'}
    return {kind: 'nothing said, left open: a whole message'}
}

/**
 * A valid bind and search on a connection of its own: the milliseconds it took, or the error
 */
async function probe(port) {
    const started = performance.now()
    let connection
    try {
        connection = await connectLDAP({url: `ldap://127.0.0.1:${port}`, connectTimeout: 5000, timeout: 5000})
        await connection.bind('uid=alice,ou=people,dc=example,dc=com', 'alice-password')
        const found = await connection.search('dc=example,dc=com', {filter: '(uid=alice)', attributes: ['mail'], paged: false})
        if (found.entries.length !== 1) throw new Error(`The probe found ${found.entries.length} entries`)
        return {time: performance.now() - started}
    } catch (error) {
        return {time: performance.now() - started, error: String(error?.message ?? error)}
    } finally {
        await connection?.close().catch(() => undefined)
    }
}

/**
 * A server in a process of its own
 */
async function start(mode) {
    const child = fork(join(here, 'server.mjs'), [mode, join(work, `component-${Date.now()}.sqlite`)], {execArgv: ['--expose-gc'], stdio: ['ignore', 'ignore', 'pipe', 'ipc']})
    const server = {child: child, stderr: [], exit: undefined, waiting: []}
    child.on('exit', (code, signal) => {
        server.exit = signal ?? `code ${code}`
        for (const waiting of server.waiting.splice(0)) waiting.reject(new Error(`The server exited (${server.exit})`))
    })
    const port = await new Promise((resolve, reject) => {
        child.once('message', (message) => resolve(message.port))
        child.once('exit', () => reject(new Error(`The ${mode} server exited before listening`)))
        child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    })
    child.stderr.removeAllListeners('data')
    child.stderr.on('data', (chunk) => server.stderr.push(...chunk.toString().split('\n').filter(Boolean)))
    child.on('message', (message) => server.waiting.shift()?.resolve(message))
    server.port = port
    server.stats = () => new Promise((resolve, reject) => {
        server.waiting.push({resolve: resolve, reject: reject})
        child.send({type: 'stats'})
    })
    server.stop = async () => {
        if (server.exit) return
        child.send({type: 'stop'})
        await new Promise((resolve) => child.once('exit', resolve))
    }
    return server
}

/**
 * Replay the cases of a set against a server: the classes, the failures
 */
async function run(mode, name, all) {
    const range = options.cases ? options.cases.split('-').map(Number) : [0, all.length - 1]
    const indexes = all.map((_, index) => index).filter((index) => index >= range[0] && index <= range[1])
    const server = await start(mode)
    const failures = []
    const results = new Array(all.length)
    const before = await server.stats()
    const flight = new Set()
    let completed = 0
    let next = 0
    let killed = false
    //The cases on their way when the server exited
    let lost = []
    server.child.on('exit', () => {
        lost = [...flight]
    })
    const fail = (kind, detail) => failures.push({kind: kind, detail: detail, flight: [...flight]})
    const worker = async () => {
        while (next < indexes.length && !server.exit) {
            const index = indexes[next++]
            flight.add(index)
            const result = await replay(server.port, all[index])
            flight.delete(index)
            if (server.exit) {
                results[index] = {index: index, kind: 'the server exited'}
                continue
            }
            const {kind, failure} = outcome(all[index], result)
            results[index] = {index: index, kind: kind, first: result.first, time: result.time, sent: all[index].length}
            if (failure) fail('outcome', `case ${index}: ${failure}`)
            if (result.first !== undefined && result.first > SLOW) fail('slow', `case ${index}: the first byte after ${Math.round(result.first)} ms`)
            if (server.stderr.length) fail('stderr', server.stderr.splice(0).join('\n'))
            completed++
            if (options['kill-after'] && completed === Number(options['kill-after']) && !killed) {
                killed = true
                server.child.kill('SIGKILL')
            }
            if (completed % PROBE_EVERY === 0) {
                const checked = await probe(server.port)
                if (checked.error || checked.time > PROBE_LIMIT) fail('probe', `after ${completed} cases: ${checked.error ?? `${Math.round(checked.time)} ms`}`)
                const stats = await server.stats().catch(() => undefined)
                if (stats?.errors.length) fail('error', stats.errors.join('\n'))
            }
        }
    }
    await Promise.all(Array.from({length: concurrency}, worker))
    if (server.exit) {
        fail('exit', `the server exited (${server.exit}) with cases ${lost.join(', ')} on their way`)
        return {mode: mode, set: name, failures: failures, results: results.filter(Boolean)}
    }
    const checked = await probe(server.port)
    if (checked.error || checked.time > PROBE_LIMIT) fail('probe', `at the end: ${checked.error ?? `${Math.round(checked.time)} ms`}`)
    //The connections the server still counts, once the cases have closed theirs
    let after = await server.stats()
    for (let tries = 0; after.connections > 0 && tries < 50; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        after = await server.stats()
    }
    if (after.errors.length) fail('error', after.errors.join('\n'))
    if (after.connections > 0) fail('connections', `${after.connections} connections still open after the cases`)
    if (after.heapUsed - before.heapUsed > HEAP_LIMIT) fail('memory', `the heap grew by ${Math.round((after.heapUsed - before.heapUsed) / 1048576)} MB`)
    if (server.stderr.length) fail('stderr', server.stderr.splice(0).join('\n'))
    await server.stop()
    return {mode: mode, set: name, failures: failures, results: results.filter(Boolean), heap: {before: before.heapUsed, after: after.heapUsed}, rss: after.rss, probe: checked.time}
}

const report = []
let failed = false
try {
    for (const name of sets) {
        const all = cases(await capture(SETS[name]))
        const distinct = new Set(all.map((bytes) => bytes.toString('hex'))).size
        for (const mode of servers) {
            const started = performance.now()
            const result = await run(mode, name, all)
            const classes = {}
            for (const item of result.results) classes[item.kind] = (classes[item.kind] ?? 0) + 1
            const firsts = result.results.map((item) => item.first).filter((value) => value !== undefined).sort((a, b) => a - b)
            console.log(`\n${mode}, ${SETS[name].title}: ${result.results.length} of ${all.length} connections (${distinct} distinct payloads) in ${Math.round((performance.now() - started) / 1000)} s`)
            for (const [kind, count] of Object.entries(classes).sort(([, a], [, b]) => b - a)) console.log(`  ${String(count).padStart(5)}  ${kind}`)
            if (firsts.length) console.log(`  first byte: median ${firsts[firsts.length >> 1].toFixed(1)} ms, 99% ${firsts[Math.floor(firsts.length * 0.99)].toFixed(1)} ms, max ${firsts.at(-1).toFixed(1)} ms`)
            if (result.heap) console.log(`  heap ${(result.heap.before / 1048576).toFixed(1)} MB before, ${(result.heap.after / 1048576).toFixed(1)} MB after; rss ${(result.rss / 1048576).toFixed(0)} MB; probe ${result.probe.toFixed(1)} ms`)
            console.log(result.failures.length ? `  FAILED: ${result.failures.length}` : '  passed')
            for (const failure of result.failures.slice(0, 20)) console.log(`    ${failure.kind}: ${failure.detail}${failure.flight.length ? ` (in flight: ${failure.flight.join(', ')})` : ''}`)
            failed ||= result.failures.length > 0
            report.push(result)
        }
    }
} finally {
    if (options.out) writeFileSync(options.out, JSON.stringify(report, null, 1))
    rmSync(work, {recursive: true, force: true})
}
process.exit(failed ? 1 : 0)
