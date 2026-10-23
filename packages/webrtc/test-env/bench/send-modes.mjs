//The CPU of one dgram send of 1200 bytes: with the address on each send, connected, and with a list of buffers. It needs
//no build of the package.
//
//   node test-env/bench/send-modes.mjs
import dgram from 'node:dgram'
import {fork} from 'node:child_process'
if (process.argv[2] === 'sink') {
    const s = dgram.createSocket('udp4')
    s.on('message', () => undefined)
    s.bind(0, '127.0.0.1', () => process.send(s.address().port))
} else {
    const sink = fork(new URL(import.meta.url), ['sink'])
    const port = await new Promise((resolve) => sink.once('message', resolve))
    const packet = Buffer.alloc(1200, 7)
    const parts = [Buffer.alloc(21, 1), Buffer.alloc(1163, 2), Buffer.alloc(16, 3)]
    const measure = async (label, socket, send) => {
        const total = 300000
        const cpu0 = process.cpuUsage()
        let sent = 0
        await new Promise((resolve) => {
            const burst = () => {
                for (let i = 0; i < 500 && sent < total; i++, sent++) send(socket)
                sent < total ? setImmediate(burst) : resolve()
            }
            burst()
        })
        const {user, system} = process.cpuUsage(cpu0)
        console.log(label.padEnd(28), ((user + system) / total).toFixed(2), 'us per send')
    }
    const a = dgram.createSocket('udp4')
    await measure('address on each send', a, (s) => s.send(packet, port, '127.0.0.1'))
    await measure('address, list of 3 buffers', a, (s) => s.send(parts, port, '127.0.0.1'))
    const c = dgram.createSocket({type: 'udp4', lookup: (address, family, callback) => callback(null, address, 4)})
    await measure('address, synchronous lookup', c, (s) => s.send(packet, port, '127.0.0.1'))
    const b = dgram.createSocket('udp4')
    await new Promise((resolve) => b.connect(port, '127.0.0.1', resolve))
    await measure('connected', b, (s) => s.send(packet))
    await measure('connected, list of 3 buffers', b, (s) => s.send(parts))
    sink.kill()
    process.exit(0)
}
