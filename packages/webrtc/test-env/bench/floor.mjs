//The floor of a pure JavaScript data path: what every packet costs at least, whatever the implementation. The sender
//encrypts each packet the way a DTLS 1.2 record is (AES-128-GCM through node:crypto, a new cipher per record, as Node
//needs a new one for each nonce) and sends it over UDP; the receiver decrypts it. With --crc both ends also compute the
//CRC32c of the packet in JavaScript, as SCTP needs. No SCTP logic, no retransmission, no events: only the unavoidable.
//
//It needs no build of the package. --rcvbuf asks for a receive buffer (capped by the system: net.core.rmem_max on Linux),
//to see the packets of a burst dropped by a small one; --callback awaits each send, the way werift did.
//
//   node test-env/bench/floor.mjs [--size 1200] [--rate 50000] [--seconds 5] [--crc] [--rcvbuf 1048576] [--callback]
import {fork} from 'node:child_process'
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import dgram from 'node:dgram'
import {parseArgs} from 'node:util'

const {values: options} = parseArgs({
    options: {
        rcvbuf: {type: 'string', default: '0'},
        size: {type: 'string', default: '1200'},
        rate: {type: 'string', default: '50000'},
        seconds: {type: 'string', default: '5'},
        crc: {type: 'boolean', default: false},
        //Each send with a callback that resolves a promise, the way werift awaits its sends
        callback: {type: 'boolean', default: false},
        role: {type: 'string'},
        port: {type: 'string'}
    }
})
const size = Number(options.size)
const key = Buffer.alloc(16, 3)
const salt = Buffer.alloc(4, 5)

const table = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
function crc32c(buffer) {
    let crc = 0xffffffff
    for (let i = 0; i < buffer.length; i++) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

//The 13 bytes of additional data and the 8 bytes of explicit nonce of a DTLS 1.2 record
function nonce(sequence) {
    const iv = Buffer.alloc(12)
    salt.copy(iv, 0)
    iv.writeUInt32BE(0, 4)
    iv.writeUInt32BE(sequence >>> 0, 8)
    return iv
}
function aad(sequence, length) {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(sequence >>> 0, 4)
    header[8] = 23
    header.writeUInt16BE(0xfefd, 9)
    header.writeUInt16BE(length, 11)
    return header
}

if (options.role === 'recv') {
    const socket = dgram.createSocket('udp4')
    let received = 0
    let failed = 0
    let cpu0
    let first = 0
    let last = 0
    socket.on('message', (packet) => {
        cpu0 ??= process.cpuUsage()
        first ||= Date.now()
        last = Date.now()
        const sequence = packet.readUInt32BE(0)
        const decipher = createDecipheriv('aes-128-gcm', key, nonce(sequence), {authTagLength: 16})
        decipher.setAuthTag(packet.subarray(packet.length - 16))
        decipher.setAAD(aad(sequence, packet.length - 24))
        const plain = decipher.update(packet.subarray(8, packet.length - 16))
        try {
            decipher.final()
            if (options.crc) crc32c(plain)
            received++
        } catch {
            failed++
        }
    })
    socket.bind(0, '127.0.0.1', () => {
        //The receive buffer asked for (capped by the system), 0 for the default
        if (Number(options.rcvbuf)) socket.setRecvBufferSize(Number(options.rcvbuf))
        process.send({type: 'port', port: socket.address().port, rcvbuf: socket.getRecvBufferSize()})
    })
    process.on('message', (message) => {
        if (message.cmd !== 'finish') return
        const {user, system} = cpu0 ? process.cpuUsage(cpu0) : {user: 0, system: 0}
        process.send({type: 'result', received, failed, cpu: (user + system) / 1e6, seconds: (last - first) / 1000})
        process.exit(0)
    })
} else if (options.role === 'send') {
    const socket = dgram.createSocket('udp4')
    const payload = randomBytes(size)
    const rate = Number(options.rate)
    const seconds = Number(options.seconds)
    let sent = 0
    const cpu0 = process.cpuUsage()
    const start = Date.now()
    //Paced: every millisecond, the packets due since the start
    const timer = setInterval(() => {
        const elapsed = Date.now() - start
        if (elapsed >= seconds * 1000) {
            clearInterval(timer)
            const {user, system} = process.cpuUsage(cpu0)
            setTimeout(() => process.send({type: 'result', sent, cpu: (user + system) / 1e6}, () => process.exit(0)), 300)
            return
        }
        const due = Math.floor(elapsed * rate / 1000)
        for (; sent < due; sent++) {
            if (options.crc) crc32c(payload)
            const cipher = createCipheriv('aes-128-gcm', key, nonce(sent), {authTagLength: 16})
            cipher.setAAD(aad(sent, size))
            const explicit = Buffer.alloc(8)
            explicit.writeUInt32BE(sent >>> 0, 0)
            const encrypted = cipher.update(payload)
            cipher.final()
            const parts = [explicit, encrypted, cipher.getAuthTag()]
            if (options.callback) {
                new Promise((resolve, reject) => socket.send(parts, Number(options.port), '127.0.0.1', (error) => error ? reject(error) : resolve())).catch(() => undefined)
            } else {
                socket.send(parts, Number(options.port), '127.0.0.1')
            }
        }
    }, 1)
} else {
    const start = (role, extra = []) => fork(new URL(import.meta.url), ['--role', role, '--size', options.size, '--rate', options.rate, '--seconds', options.seconds, ...(options.crc ? ['--crc'] : []), ...(options.callback ? ['--callback'] : []), '--rcvbuf', options.rcvbuf, ...extra])
    const next = (child, type) => new Promise((resolve) => child.on('message', (message) => message.type === type && resolve(message)))
    const receiver = start('recv')
    const {port} = await next(receiver, 'port')
    const sender = start('send', ['--port', String(port)])
    const sent = await next(sender, 'result')
    const result = next(receiver, 'result')
    receiver.send({cmd: 'finish'})
    const received = await result
    const packets = received.received
    console.log(JSON.stringify({
        size,
        rate: Number(options.rate),
        crc: options.crc,
        callback: options.callback,
        delivered: +(packets / sent.sent).toFixed(3),
        MiBps: +(packets * size / 1048576 / Math.max(received.seconds, 0.001)).toFixed(1),
        senderMicrosPerPacket: +(sent.cpu / sent.sent * 1e6).toFixed(2),
        receiverMicrosPerPacket: +(received.cpu / Math.max(packets, 1) * 1e6).toFixed(2),
        cpuSecondsPerGiB: +((sent.cpu / sent.sent + received.cpu / Math.max(packets, 1)) * (1073741824 / size)).toFixed(1)
    }))
    process.exit(0)
}
