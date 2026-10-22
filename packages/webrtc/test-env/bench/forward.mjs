//The benchmark of the forwarding of media: publishers send video to a server, which forwards each track to every
//subscriber. The server runs in this process, the publishers and the subscribers in a child process: the CPU measured is
//the one of the server only. Each publisher sends about the bit rate of 720p: 200 packets of 1250 bytes a second.
//
//   npm run compile && node test-env/bench/forward.mjs [--sfu [--rooms 1] [--workers 0]] [--publishers 2] [--subscribers 4]
//                                                      [--seconds 10] [--no-extensions]
//
//The server is a relay forwarding a track it receives by adding it to the connections of the subscribers, or with --sfu
//the media server (SFU) of rooms of the signaling, the members being SignalingClients (the publishers receive nothing):
//--rooms rooms of --publishers and --subscribers each, the members of each in a child process of its own, forwarded in the
//main thread or in --workers worker threads.
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {socketIOServiceEntrypoint} from '@lakutata/entrypoint/adapter/socket.io'
//WEBRTC_BENCH_DIST: the exports of another build (dist/esm/exports/WebRTC.js), to compare two builds
const {MediaTrack, PeerConnection, SFU, Signaling, SignalingClient, SignalingController} = await import(process.env.WEBRTC_BENCH_DIST ?? '../../dist/esm/exports/WebRTC.js')

const {values: options, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        sfu: {type: 'boolean', default: false},
        publishers: {type: 'string', default: '2'},
        subscribers: {type: 'string', default: '4'},
        seconds: {type: 'string', default: '10'},
        rooms: {type: 'string', default: '1'},
        workers: {type: 'string', default: '0'},
        'no-extensions': {type: 'boolean', default: false},
        //The room of a child process
        room: {type: 'string', default: '0'}
    }
})
const publishers = Number(options.publishers)
const subscribers = Number(options.subscribers)
const seconds = Number(options.seconds)
const rooms = options.sfu ? Number(options.rooms) : 1
const workers = Number(options.workers)
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
 * A video track to publish
 */
function videoTrack() {
    return new MediaTrack('video', {codec: 'video/VP8'})
}

/**
 * Count the packets of a track received
 * @param counters
 * @param track
 */
function count(counters, track) {
    track.on('rtp', (packet) => {
        counters.received++
        counters.receivedBytes += packet.payload.length
    })
}

/**
 * The publishers and the subscribers, in the child process: they do what the server asks
 */
async function clients() {
    const container = new Container()
    const publishing = []
    const tracks = []
    const counters = {sent: 0, received: 0, receivedBytes: 0}
    let timer
    const handle = async (message) => {
        switch (message.type) {
            //The relay: the publishers offer, the relay offers to the subscribers
            case 'offer': {
                const connection = await container.get(PeerConnection, connectionOptions)
                const track = videoTrack()
                connection.addTrack(track, `publisher-${publishing.length}`)
                publishing.push(connection)
                tracks.push(track)
                return await describe(connection)
            }
            case 'answered':
                return void await publishing[message.index].setRemoteDescription(message.answer)
            case 'answer': {
                const connection = await container.get(PeerConnection, connectionOptions)
                connection.on('track', (track) => count(counters, track))
                return await describe(connection, message.offer)
            }
            //The media server: members of a room
            case 'join': {
                for (let index = 0; index < subscribers; index++) {
                    const client = await container.get(SignalingClient, {url: message.url, id: `${options.room}-subscriber-${index}`})
                    const room = await client.join(`bench-${options.room}`)
                    room.on('peer', (peer) => peer.on('track', (event) => count(counters, event.track)))
                }
                for (let index = 0; index < publishers; index++) {
                    const client = await container.get(SignalingClient, {url: message.url, id: `${options.room}-publisher-${index}`})
                    const room = await client.join(`bench-${options.room}`)
                    const track = videoTrack()
                    tracks.push(track)
                    await room.publish(track, `publisher-${index}`)
                }
                return
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
 * The relay: it connects the publishers, then the subscribers
 * @param container
 * @param request Asks a child process.
 */
async function relay(container, request) {
    const tracks = []
    for (let index = 0; index < publishers; index++) {
        const connection = await container.get(PeerConnection, connectionOptions)
        const track = new Promise((resolve) => connection.once('track', resolve))
        const answer = await describe(connection, await request(0, {type: 'offer'}))
        await request(0, {type: 'answered', index: index, answer: answer})
        tracks.push(await track)
    }
    for (let index = 0; index < subscribers; index++) {
        const connection = await container.get(PeerConnection, connectionOptions)
        for (const track of tracks) connection.addTrack(track, track.id)
        await connection.setRemoteDescription(await request(0, {type: 'answer', offer: await describe(connection)}))
    }
}

/**
 * The media server: the signaling and the SFU over Socket.IO, the members joining their rooms; the publishers receive
 * nothing
 * @param container
 * @param request Asks a child process.
 */
async function sfu(container, request) {
    await container.setNamed('signaling', Signaling, {})
    await container.setNamed('sfu', SFU, {workers: workers, select: (subscriber) => subscriber.peerId.includes('-subscriber-')})
    let port = 0
    await container.setNamed('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [SignalingController],
        service: socketIOServiceEntrypoint({port: 0, host: '127.0.0.1', listening: (_io, server) => {
            port = server.address().port
        }})
    }))
    for (let room = 0; room < rooms; room++) await request(room, {type: 'join', url: `http://127.0.0.1:${port}`})
}

/**
 * The server: it connects the publishers and the subscribers, and measures itself while forwarding
 */
async function server() {
    const children = Array.from({length: rooms}, (_, room) => fork(fileURLToPath(import.meta.url), ['clients', ...process.argv.slice(2), '--room', String(room)], {stdio: 'inherit'}))
    const pending = new Map()
    let requests = 0
    for (const child of children) {
        child.on('message', ({id, result}) => {
            pending.get(id)(result)
            pending.delete(id)
        })
    }
    const request = (index, message) => new Promise((resolve) => {
        pending.set(++requests, resolve)
        children[index].send({...message, id: requests})
    })
    //Asks every child process; their counters are added
    const requestAll = async (message) => {
        const results = await Promise.all(children.map((_, index) => request(index, message)))
        return results[0] && {sent: 0, received: 0, receivedBytes: 0, ...Object.fromEntries(Object.keys(results[0]).map((key) => [key, results.reduce((sum, result) => sum + result[key], 0)]))}
    }
    const container = new Container()
    try {
        await (options.sfu ? sfu : relay)(container, request)
        await requestAll({type: 'start'})
        await new Promise((resolve) => setTimeout(resolve, WARM_UP))

        const before = {counters: await requestAll({type: 'counters'}), cpu: process.cpuUsage(), time: performance.now()}
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        const after = {counters: await requestAll({type: 'counters'}), cpu: process.cpuUsage(before.cpu), time: performance.now()}
        const elapsed = (after.time - before.time) / 1000
        const sent = (after.counters.sent - before.counters.sent) / elapsed
        const forwarded = (after.counters.received - before.counters.received) / elapsed
        const bytes = after.counters.receivedBytes - before.counters.receivedBytes
        const cpu = (after.cpu.user + after.cpu.system) / 1e6
        const share = cpu / elapsed
        const format = (value, digits = 0) => value.toLocaleString('en-US', {maximumFractionDigits: digits})
        const where = options.sfu ? `${rooms} room${rooms > 1 ? 's' : ''} of ` : ''
        const threads = options.sfu ? `, ${workers ? `${workers} worker threads` : 'main thread'}` : ''
        console.log(`${options.sfu ? 'SFU' : 'relay'}: ${where}${publishers} publishers, ${subscribers} subscribers${threads}, header extensions ${connectionOptions.headerExtensions || options.sfu ? 'on' : 'off'}, ${format(elapsed, 1)} s, Node.js ${process.version}`)
        console.log(`sent by the publishers   ${format(sent)} packets/s`)
        console.log(`forwarded                ${format(forwarded)} packets/s, ${format(bytes * 8 / elapsed / 1e6, 1)} Mbit/s of payload (expected ${format(sent * subscribers)} packets/s)`)
        console.log(`server CPU               ${format(share * 100, 1)} % of a core (user ${format(after.cpu.user / 1e6 / elapsed * 100, 1)} %, system ${format(after.cpu.system / 1e6 / elapsed * 100, 1)} %)`)
        console.log(`per core                 ${format(forwarded / share)} packets/s forwarded`)
        console.log(`per GiB of payload       ${format(cpu / (bytes / 2 ** 30), 1)} CPU seconds`)
        console.log(`per packet forwarded     ${format(cpu * 1e6 / (forwarded * elapsed), 2)} CPU microseconds`)
        console.log(`server memory            ${format(process.memoryUsage().rss / 2 ** 20)} MiB resident`)
    } finally {
        await requestAll({type: 'stop'})
        await container.destroy()
    }
}

if (positionals[0] === 'clients') await clients()
else await server()
