//The benchmark of the forwarding of media: publishers send video to a relay, which forwards each track to every
//subscriber. The relay runs in this process, the publishers and the subscribers in a child process: the CPU measured is
//the one of the relay only. Each publisher sends about the bit rate of 720p: 200 packets of 1250 bytes a second.
//
//   npm run compile && node test-env/bench/forward.mjs [--publishers 2] [--subscribers 4] [--seconds 10] [--no-extensions]
//
//The relay forwards a track it receives by adding it to the connections of the subscribers.
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'
import {MediaTrack, PeerConnection} from '../../dist/esm/exports/WebRTC.js'

const {values: options, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        publishers: {type: 'string', default: '2'},
        subscribers: {type: 'string', default: '4'},
        seconds: {type: 'string', default: '10'},
        'no-extensions': {type: 'boolean', default: false}
    }
})
const publishers = Number(options.publishers)
const subscribers = Number(options.subscribers)
const seconds = Number(options.seconds)
const connectionOptions = {headerExtensions: !options['no-extensions'], iceUseIpv6: false}
//A publisher sends 2 packets every 10 ms
const PAYLOAD_SIZE = 1250
const PACKETS_PER_TICK = 2
//Before measuring
const WARM_UP = 3000

/**
 * The description of a connection with all its candidates
 * @param connection
 * @param remote The description to answer, none to offer
 */
async function describe(connection, remote) {
    const gathered = new Promise((resolve) => connection.on('icecandidate', (candidate) => {
        if (!candidate) resolve()
    }))
    if (remote) await connection.setRemoteDescription(remote)
    await connection.setLocalDescription()
    await gathered
    return connection.localDescription
}

/**
 * The publishers and the subscribers, in the child process: they do what the relay asks
 */
async function clients() {
    const container = new Container()
    const publishing = []
    const tracks = []
    const counters = {sent: 0, received: 0, receivedBytes: 0}
    let timer
    const handle = async (message) => {
        switch (message.type) {
            case 'offer': {
                const connection = await container.get(PeerConnection, connectionOptions)
                const track = new MediaTrack('video', {codec: 'video/VP8'})
                connection.addTrack(track, `publisher-${publishing.length}`)
                publishing.push(connection)
                tracks.push(track)
                return await describe(connection)
            }
            case 'answered':
                return void await publishing[message.index].setRemoteDescription(message.answer)
            case 'answer': {
                const connection = await container.get(PeerConnection, connectionOptions)
                connection.on('track', (track) => track.on('rtp', (packet) => {
                    counters.received++
                    counters.receivedBytes += packet.payload.length
                }))
                return await describe(connection, message.offer)
            }
            case 'start': {
                const payload = Buffer.alloc(PAYLOAD_SIZE, 1)
                let sequenceNumber = 0
                timer = setInterval(() => {
                    for (let index = 0; index < PACKETS_PER_TICK; index++, sequenceNumber++) {
                        const header = Buffer.alloc(12)
                        header[0] = 0x80
                        header[1] = 96
                        header.writeUInt16BE(sequenceNumber & 0xffff, 2)
                        header.writeUInt32BE((sequenceNumber * 450) >>> 0, 4)
                        const packet = Buffer.concat([header, payload])
                        for (const track of tracks) track.writeRtp(packet)
                        counters.sent += tracks.length
                    }
                }, 10)
                return
            }
            case 'counters':
                return {...counters}
            case 'stop':
                clearInterval(timer)
                await container.destroy()
                return
        }
    }
    process.on('message', async (message) => {
        process.send({id: message.id, result: await handle(message)})
        if (message.type === 'stop') process.disconnect()
    })
}

/**
 * The relay: it connects the publishers, then the subscribers, and measures itself while forwarding
 */
async function relay() {
    const child = fork(fileURLToPath(import.meta.url), ['clients', ...process.argv.slice(2)], {stdio: 'inherit'})
    const pending = new Map()
    let requests = 0
    child.on('message', ({id, result}) => {
        pending.get(id)(result)
        pending.delete(id)
    })
    const request = (message) => new Promise((resolve) => {
        pending.set(++requests, resolve)
        child.send({...message, id: requests})
    })
    const container = new Container()
    try {
        const tracks = []
        for (let index = 0; index < publishers; index++) {
            const connection = await container.get(PeerConnection, connectionOptions)
            const track = new Promise((resolve) => connection.once('track', resolve))
            const answer = await describe(connection, await request({type: 'offer'}))
            await request({type: 'answered', index: index, answer: answer})
            tracks.push(await track)
        }
        for (let index = 0; index < subscribers; index++) {
            const connection = await container.get(PeerConnection, connectionOptions)
            for (const track of tracks) connection.addTrack(track, track.id)
            await connection.setRemoteDescription(await request({type: 'answer', offer: await describe(connection)}))
        }
        await request({type: 'start'})
        await new Promise((resolve) => setTimeout(resolve, WARM_UP))

        const before = {counters: await request({type: 'counters'}), cpu: process.cpuUsage(), time: performance.now()}
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        const after = {counters: await request({type: 'counters'}), cpu: process.cpuUsage(before.cpu), time: performance.now()}
        const elapsed = (after.time - before.time) / 1000
        const sent = (after.counters.sent - before.counters.sent) / elapsed
        const forwarded = (after.counters.received - before.counters.received) / elapsed
        const bytes = after.counters.receivedBytes - before.counters.receivedBytes
        const cpu = (after.cpu.user + after.cpu.system) / 1e6
        const share = cpu / elapsed
        const format = (value, digits = 0) => value.toLocaleString('en-US', {maximumFractionDigits: digits})
        console.log(`${publishers} publishers, ${subscribers} subscribers, header extensions ${connectionOptions.headerExtensions ? 'on' : 'off'}, ${format(elapsed, 1)} s, Node.js ${process.version}`)
        console.log(`sent by the publishers   ${format(sent)} packets/s`)
        console.log(`forwarded                ${format(forwarded)} packets/s, ${format(bytes * 8 / elapsed / 1e6, 1)} Mbit/s of payload (expected ${format(sent * subscribers)} packets/s)`)
        console.log(`relay CPU                ${format(share * 100, 1)} % of a core (user ${format(after.cpu.user / 1e6 / elapsed * 100, 1)} %, system ${format(after.cpu.system / 1e6 / elapsed * 100, 1)} %)`)
        console.log(`per core                 ${format(forwarded / share)} packets/s forwarded`)
        console.log(`per GiB of payload       ${format(cpu / (bytes / 2 ** 30), 1)} CPU seconds`)
        console.log(`relay memory             ${format(process.memoryUsage().rss / 2 ** 20)} MiB resident`)
    } finally {
        await request({type: 'stop'})
        await container.destroy()
    }
}

if (positionals[0] === 'clients') await clients()
else await relay()
