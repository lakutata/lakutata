//The client of the end-to-end test in k3s. Two members connected to two different pods of the signaling, relayed only
//through the TURN servers of the cluster, a data channel between them; the pod of the second one is deleted (run.sh
//does it when it reads the line DELETE), the first pod takes it out of the room, and the channel still carries the
//messages. Then two members in a room of the media servers, given by the signaling the media servers of two nodes (one
//member at most on each), receiving the video of each other forwarded between the nodes, a data channel between them;
//the pod of the media server of the second one is deleted (the line DELETE-POD), the second one joins the room again
//until the pod made again on its node takes it, and the first one receives its video again. The last line is RESULT
//ok, or RESULT failed with the reason.
import {promises as dns} from 'node:dns'
import {Container} from '@lakutata/core'
import {MediaTrack, SignalingClient} from '@lakutata/webrtc'

/**
 * Wait for a condition, polling it
 */
async function until(condition, timeout, what) {
    const deadline = Date.now() + timeout
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
}

/**
 * Write a packet of video to a track every 10 ms, its payload carrying a number from first
 */
function feed(track, first) {
    let number = first
    const timer = setInterval(() => {
        const packet = Buffer.alloc(16)
        packet[0] = 0x80
        packet[1] = 96
        packet.writeUInt16BE(number & 0xffff, 2)
        packet.writeUInt32BE((number * 900) >>> 0, 4)
        packet.writeUInt32BE(number, 12)
        track.writeRtp(packet)
        number++
    }, 10)
    return () => clearInterval(timer)
}

/**
 * Whether the next packets of a track carry numbers from first
 */
async function from(track, first) {
    const packets = await new Promise((resolve, reject) => {
        const received = []
        const timer = setTimeout(() => reject(new Error('Timed out waiting for packets')), 10000)
        const listener = (packet) => {
            received.push(packet)
            if (received.length < 5) return
            clearTimeout(timer)
            track.off('rtp', listener)
            resolve(received)
        }
        track.on('rtp', listener)
    })
    return packets.every((packet) => packet.payload.readUInt32BE(0) >= first && packet.payload.readUInt32BE(0) < first + 100000)
}

/**
 * Join a room through a pod of the signaling and publish a video, keeping the video tracks received by member
 */
async function member(clients, address, id, room, first) {
    const client = await clients.get(SignalingClient, {url: `http://${address}:3000`, id: id})
    const joined = await client.join(room)
    const received = new Map()
    joined.on('peer', (peer) => peer.on('track', (event) => {
        if (event.track.kind === 'video') received.set(peer.id, [...received.get(peer.id) ?? [], event.track])
    }))
    const video = new MediaTrack('video', {codec: 'video/VP8'})
    const stop = feed(video, first)
    await joined.publish(video, 'camera')
    return {room: joined, received: received, stop: stop}
}

/**
 * The state of a pod of the signaling: its rooms and the nodes of the cluster
 */
async function stateOf(address) {
    return await (await fetch(`http://${address}:8080/`)).json()
}

const clients = new Container()
try {
    const pods = (await dns.resolve4(process.env.SIGNALING_HOST)).sort()
    if (pods.length !== 2) throw new Error(`Two pods of the signaling expected, found ${pods.join(', ')}`)
    const [first, second] = pods
    //The cluster: two pods of the signaling, a TURN server on each node of k3s
    await until(async () => (await stateOf(first)).nodes.filter((node) => node.services.turn).length === 2, 60000, 'the TURN servers in the cluster')
    console.log('NODES', JSON.stringify((await stateOf(first)).nodes.map((node) => [node.id, node.services.turn?.address ?? null])))
    const alice = await clients.get(SignalingClient, {url: `http://${first}:3000`, id: 'alice', iceTransportPolicy: 'relay'})
    const bob = await clients.get(SignalingClient, {url: `http://${second}:3000`, id: 'bob', iceTransportPolicy: 'relay'})
    const aliceRoom = await alice.join('e2e')
    const bobRoom = await bob.join('e2e')
    const turnUrls = alice.iceServers.flatMap((server) => [server.urls].flat()).filter((url) => url.startsWith('turn:'))
    console.log('TURN', JSON.stringify(turnUrls))
    if (new Set(turnUrls.map((url) => url.split(':')[1])).size !== 2) throw new Error('The TURN servers of both nodes expected')
    //Alice echoes, Bob sends
    aliceRoom.on('peer', (peer) => {
        peer.on('datachannel', (channel) => channel.on('message', (data) => channel.send(`echo: ${data.toString()}`)))
    })
    const replies = []
    let channel
    bobRoom.on('peer', (peer) => {
        channel = peer.createDataChannel('chat')
        channel.on('message', (data) => replies.push(data.toString()))
        channel.on('open', () => channel.send('hello'))
    })
    await until(() => replies.includes('echo: hello'), 30000, 'the echo')
    console.log('ECHO', replies[0])
    //The pod of Bob deleted: Alice's pod takes Bob out of the room
    console.log(`DELETE ${second}`)
    await until(async () => JSON.stringify((await stateOf(first)).rooms.e2e) === JSON.stringify(['alice']), 60000, 'Bob out of the room')
    console.log('ROOM', JSON.stringify((await stateOf(first)).rooms))
    //The relayed connection does not need the signaling
    channel.send('again')
    await until(() => replies.includes('echo: again'), 10000, 'the echo after the pod went away')
    console.log('ECHO', 'echo: again')
    //The media servers: one on each node, both in the cluster
    await until(async () => (await stateOf(first)).nodes.filter((node) => node.services.sfu).length === 2, 60000, 'the media servers in the cluster')
    console.log('SFU NODES', JSON.stringify((await stateOf(first)).nodes.filter((node) => node.services.sfu).map((node) => node.id)))
    //Carol and Dave through the pod of the signaling left, each on the media server of a node
    const carol = await member(clients, first, 'carol', 'sfu-e2e', 0)
    const dave = await member(clients, first, 'dave', 'sfu-e2e', 100000)
    const stops = [carol.stop, dave.stop]
    try {
        console.log('SFU', carol.room.sfu, dave.room.sfu)
        if (!carol.room.sfu || !dave.room.sfu || carol.room.sfu === dave.room.sfu) throw new Error('The media servers of two nodes expected')
        await until(() => carol.received.has('dave') && dave.received.has('carol'), 30000, 'the videos forwarded between the nodes')
        if (!await from(carol.received.get('dave')[0], 100000) || !await from(dave.received.get('carol')[0], 0)) throw new Error('The packets of the other member expected')
        console.log('VIDEO', 'forwarded between the nodes')
        //A data channel through both media servers
        const echoes = []
        dave.room.on('peer', (peer) => peer.on('datachannel', (channel) => channel.on('message', (data) => channel.send(`echo: ${data.toString()}`))))
        await until(() => !!carol.room.peer('dave'), 10000, 'the peer of dave')
        const toDave = carol.room.peer('dave').createDataChannel('chat')
        toDave.on('message', (data) => echoes.push(data.toString()))
        toDave.on('open', () => toDave.send('hello'))
        await until(() => echoes.includes('echo: hello'), 30000, 'the echo through the media servers')
        console.log('ECHO', echoes[0])
        //The media server of Dave goes away: Dave joins again (the other node is full) until the pod made again on
        //his node takes him, and publishes again
        const gone = dave.room.sfu
        console.log(`DELETE-POD ${gone.slice('sfu:'.length)}`)
        await until(() => dave.room.sfu !== gone && carol.received.get('dave').length === 2, 120000, 'dave on the new media server of his node')
        if (!await from(carol.received.get('dave')[1], 100000)) throw new Error('The packets of dave again expected')
        console.log('SFU', carol.room.sfu, dave.room.sfu)
    } finally {
        stops.forEach((stop) => stop())
    }
    console.log('RESULT ok')
} catch (error) {
    console.log(`RESULT failed: ${error.message}`)
    process.exitCode = 1
} finally {
    await clients.destroy().catch(() => undefined)
    process.exit()
}
