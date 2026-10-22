import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {MediaTrack} from '../peer/MediaTrack.js'
import {engineChannelOf} from '../peer/EngineConnection.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {PeerConnection, type PeerTrackEvent} from '../peer/PeerConnection.js'
import type {RtpTransceiver} from '../peer/RtpTransceiver.js'
import type {RtpPacket} from '../peer/RtpPacket.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {SFUTrack} from '../sfu/SFU.js'
import type {WHIPSession} from '../whip/WHIP.js'
import {feed, packets} from './support/Media.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * A member of a room publishing a video, and the tracks it receives from each other member
 */
type Member = {
    room: Room
    video: MediaTrack
    received: Map<string, PeerTrackEvent[]>
    stop(): void
}

/**
 * Join a room and publish a video whose packets carry numbers from `first`
 * @param clients
 * @param server
 * @param id
 * @param first
 * @param options More options of the client.
 */
async function member(clients: Container, server: TestServer, id: string, first: number, options: {codecs?: string[]} = {}): Promise<Member> {
    const client: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: id, ...options})
    //The first video codec it has
    const codec: string = options.codecs?.find((each: string): boolean => each.startsWith('video/')) ?? 'video/VP8'
    const room: Room = await client.join('meeting')
    const received: Map<string, PeerTrackEvent[]> = new Map()
    room.on('peer', (peer: Peer): void => {
        peer.on('track', (event: PeerTrackEvent): void => void received.set(peer.id, [...received.get(peer.id) ?? [], event]))
    })
    const video: MediaTrack = new MediaTrack('video', {codec: codec})
    const stop: () => void = feed(video, first)
    await room.publish(video, 'camera')
    return {room: room, video: video, received: received, stop: stop}
}

/**
 * Whether the packets of a track come from the member whose numbers start at `first` (100000 numbers each)
 * @param track
 * @param first
 */
async function from(track: MediaTrack, first: number): Promise<boolean> {
    return (await packets(track, 5)).every((packet: RtpPacket): boolean => {
        const number: number = packet.payload.readUInt32BE(0)
        return number >= first && number < first + 100000
    })
}

/**
 * A publisher of WHIP from Node.js: an audio and a video track whose packets carry numbers from `first`, their offer
 * POSTed with all its candidates
 * @param container
 * @param url The URL of the endpoint.
 * @param first
 * @returns The connection, the response, its URL, and a function stopping the packets.
 */
async function whipPublisher(container: Container, url: string, first: number): Promise<{connection: PeerConnection, response: Response, location?: string, stop(): void}> {
    const connection: PeerConnection = await container.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1']})
    const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
    const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
    const stops: (() => void)[] = [feed(audio, first), feed(video, first)]
    connection.addTransceiver(audio, {direction: 'sendonly', streams: ['broadcast']})
    connection.addTransceiver(video, {direction: 'sendonly', streams: ['broadcast']})
    await connection.setLocalDescription()
    await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the candidates')
    const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: connection.localDescription!.sdp})
    if (response.status === 201) await connection.setRemoteDescription({type: 'answer', sdp: await response.text()})
    return {connection: connection, response: response, location: response.headers.get('Location') ?? undefined, stop: (): void => stops.forEach((stop: () => void): void => stop())}
}

describe('SFU', (): void => {

    it('forwards the tracks of each member to the others, reusing the transceivers of the members who left', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {}})
        const clients: Container = new Container()
        const members: Member[] = []
        const published: SFUTrack[] = []
        const unpublished: SFUTrack[] = []
        server.sfu!.on('publish', (track: SFUTrack): unknown => published.push(track))
        server.sfu!.on('unpublish', (track: SFUTrack): unknown => unpublished.push(track))
        try {
            const alice: Member = await member(clients, server, 'alice', 0)
            const bob: Member = await member(clients, server, 'bob', 100000)
            const carol: Member = await member(clients, server, 'carol', 200000)
            members.push(alice, bob, carol)
            assert.match(alice.room.sfu!, /^sfu:/)
            //Each member receives the video of each other member, from the server
            for (const [index, each] of members.entries()) {
                await until((): boolean => each.received.size === 2, 20000, `the tracks of ${['alice', 'bob', 'carol'][index]}`)
            }
            for (const [id, first] of [['bob', 100000], ['carol', 200000]] as [string, number][]) {
                const event: PeerTrackEvent = alice.received.get(id)![0]
                assert.ok(await from(event.track, first), `the packets of ${id}`)
                assert.deepStrictEqual(alice.room.streamOf(event.streams[0].id), {id: event.streams[0].id, peerId: id, stream: 'camera'})
            }
            //One connection, to the server
            assert.strictEqual(alice.room.peer('bob')!.connection, alice.room.peer('carol')!.connection)
            assert.deepStrictEqual(server.sfu!.rooms().meeting.members.sort(), ['alice', 'bob', 'carol'])
            assert.deepStrictEqual(published.map((track: SFUTrack): string => `${track.peerId} ${track.kind} ${track.codec} ${track.stream}`).sort(), [
                'alice video video/VP8 camera',
                'bob video video/VP8 camera',
                'carol video video/VP8 camera'
            ])
            //A key frame asked for by a member reaches the publisher
            const asked: Promise<void> = next<void>((resolve: () => void): unknown => bob.video.once('keyframerequest', resolve), 5000, 'the key frame request')
            alice.received.get('bob')![0].track.requestKeyFrame()
            await asked
            //Carol leaves: her track ends, Dave's comes on the transceiver it was received on
            const carolLeft: Promise<Peer> = next<Peer>((resolve: (peer: Peer) => void): unknown => alice.room.on('peer-left', resolve), 10000, 'carol leaving')
            const transceiver = alice.received.get('carol')![0].transceiver
            carol.stop()
            await carol.room.leave()
            assert.strictEqual((await carolLeft).id, 'carol')
            await until((): boolean => unpublished.some((track: SFUTrack): boolean => track.peerId === 'carol'), 10000, 'the track of carol unpublished')
            await until((): boolean => transceiver.currentDirection === 'inactive', 10000, 'the transceiver of carol inactive')
            const dave: Member = await member(clients, server, 'dave', 300000)
            members.push(dave)
            await until((): boolean => alice.received.has('dave'), 20000, 'the track of dave')
            const event: PeerTrackEvent = alice.received.get('dave')![0]
            assert.strictEqual(event.transceiver, transceiver)
            assert.ok(await from(event.track, 300000), 'the packets of dave')
            assert.strictEqual(alice.room.peer('bob')!.connection.getTransceivers().length, 3)
            //Bob unpublishes his video: it ends for the others; his next one takes the same transceivers, his and theirs
            const bobConnection: PeerConnection = bob.room.peer('alice')!.connection
            const transceivers: number = bobConnection.getTransceivers().length
            const atAlice: RtpTransceiver = alice.received.get('bob')![0].transceiver
            await bob.room.unpublish(bob.video)
            await until((): boolean => unpublished.some((track: SFUTrack): boolean => track.peerId === 'bob'), 10000, 'the video of bob unpublished')
            await until((): boolean => atAlice.currentDirection === 'inactive', 10000, 'the video of bob inactive at alice')
            await until((): boolean => bobConnection.getTransceivers().some((transceiver: RtpTransceiver): boolean => transceiver.currentDirection === 'inactive'), 10000, 'the transceiver of bob inactive')
            const screen: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
            members.push({room: bob.room, video: screen, received: new Map(), stop: feed(screen, 400000)})
            await bob.room.publish(screen, 'screen')
            await until((): boolean => alice.received.get('bob')!.length === 2, 20000, 'the second video of bob')
            const second: PeerTrackEvent = alice.received.get('bob')![1]
            assert.strictEqual(second.transceiver, atAlice)
            assert.deepStrictEqual(alice.room.streamOf(second.streams[0].id), {id: second.streams[0].id, peerId: 'bob', stream: 'screen'})
            assert.ok(await from(second.track, 400000), 'the packets of the second video of bob')
            assert.strictEqual(bobConnection.getTransceivers().length, transceivers)
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await server.stop()
        }
    })

    it('pauses a track a member receives, and gives up the ones of a codec it does not have', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {}})
        const clients: Container = new Container()
        const members: Member[] = []
        const unsupported: string[] = []
        server.sfu!.on('unsupported', (room: string, peerId: string, track: SFUTrack): unknown => unsupported.push(`${room} ${peerId} ${track.peerId} ${track.codec}`))
        try {
            const alice: Member = await member(clients, server, 'alice', 0)
            const bob: Member = await member(clients, server, 'bob', 100000)
            members.push(alice, bob)
            await until((): boolean => alice.received.size === 1, 20000, 'the track of bob')
            const track: MediaTrack = alice.received.get('bob')![0].track
            await packets(track, 5)
            let count: number = 0
            track.on('rtp', (): number => count++)
            alice.room.peer('bob')!.pause(track)
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            const paused: number = count
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            assert.strictEqual(count, paused, 'no packet while paused')
            //Resumed from a key frame
            const asked: Promise<void> = next<void>((resolve: () => void): unknown => bob.video.once('keyframerequest', resolve), 5000, 'the key frame request')
            alice.room.peer('bob')!.resume(track)
            await asked
            await until((): boolean => count > paused + 10, 5000, 'the packets again')
            //A member without VP8 does not receive the videos, and publishes H.264
            const carol: Member = await member(clients, server, 'carol', 200000, {codecs: ['audio/opus', 'video/H264']})
            members.push(carol)
            await until((): boolean => unsupported.length === 2, 20000, 'the tracks carol cannot receive')
            assert.deepStrictEqual(unsupported.sort(), ['meeting carol alice video/VP8', 'meeting carol bob video/VP8'])
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await server.stop()
        }
    })

    it('relays the data channels between the members, the sender waiting for a member receiving slowly', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            const alice: Member = await member(clients, server, 'alice', 0)
            const bob: Member = await member(clients, server, 'bob', 100000)
            members.push(alice, bob)
            //Bob echoes the messages of the channels he gets, and counts the bytes of bulk
            const opened: Map<string, PeerChannel> = new Map()
            let bulk: number[] = []
            bob.room.on('peer', (peer: Peer): void => void peer.on('datachannel', (channel: PeerChannel): void => {
                opened.set(channel.label, channel)
                if (channel.label === 'bulk') return void channel.on('message', (data: string | Buffer | ArrayBuffer): number => bulk.push((data as Buffer).readUInt32BE(0)))
                channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(typeof data === 'string' ? `echo: ${data}` : data as Buffer))
            }))
            await until((): boolean => !!alice.room.peer('bob'), 10000, 'the peer of bob')
            const toBob: PeerChannel = alice.room.peer('bob')!.createDataChannel('chat')
            assert.strictEqual(toBob.protocol, 'bob')
            await next<void>((resolve: () => void): unknown => toBob.once('open', resolve), 10000, 'the open channel')
            const echoed: Promise<unknown> = next<unknown>((resolve: (data: unknown) => void): unknown => toBob.once('message', resolve), 10000, 'the echo')
            toBob.send('hello')
            assert.strictEqual(await echoed, 'echo: hello')
            const binary: Promise<unknown> = next<unknown>((resolve: (data: unknown) => void): unknown => toBob.once('message', resolve), 10000, 'the binary echo')
            toBob.send(Buffer.from([1, 2, 3]))
            assert.deepStrictEqual(await binary, Buffer.from([1, 2, 3]))
            //Bob's side: the label, the id of alice as the protocol, the settings
            const chat: PeerChannel = opened.get('chat')!
            assert.deepStrictEqual([chat.protocol, chat.ordered, chat.maxRetransmits], ['alice', true, null])
            alice.room.peer('bob')!.createDataChannel('state', {ordered: false, maxRetransmits: 0})
            await until((): boolean => opened.has('state'), 10000, 'the unreliable channel')
            assert.deepStrictEqual([opened.get('state')!.ordered, opened.get('state')!.maxRetransmits], [false, 0])
            assert.throws((): unknown => alice.room.peer('bob')!.createDataChannel('other', {protocol: 'mine'}), TypeError)
            //Bob receives slowly (his receive window held): alice waits, the server keeps a few megabytes
            const toBulk: PeerChannel = alice.room.peer('bob')!.createDataChannel('bulk')
            await next<void>((resolve: () => void): unknown => toBulk.once('open', resolve), 10000, 'the bulk channel')
            await until((): boolean => opened.has('bulk'), 10000, 'the bulk channel of bob')
            const window = engineChannelOf(opened.get('bulk')!).sctp
            window.holdReceived(1 << 30)
            const count: number = 768
            for (let index: number = 0; index < count; index++) {
                const message: Buffer = Buffer.alloc(16384)
                message.writeUInt32BE(index, 0)
                toBulk.send(message)
            }
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 2000))
            assert.ok(bulk.length * 16384 < 2 * 1024 * 1024, `bob got ${bulk.length} messages`)
            assert.ok(toBulk.bufferedAmount > 8 * 1024 * 1024, `alice has ${toBulk.bufferedAmount} bytes waiting`)
            //Bob reads again: everything arrives, in order
            window.releaseReceived(1 << 30)
            await until((): boolean => bulk.length === count, 30000, 'the bulk messages')
            assert.ok(bulk.every((index: number, position: number): boolean => index === position))
            //Closed by alice: closed for bob
            const closed: Promise<void> = next<void>((resolve: () => void): unknown => chat.once('close', resolve), 10000, 'the closed channel')
            toBob.close()
            await closed
            bulk = []
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await server.stop()
        }
    })

    it('takes a stream published with WHIP into a room, as a member the others receive', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {serves: (room: string): boolean => room !== 'lobby'}, whip: {}})
        const clients: Container = new Container()
        const stops: (() => void)[] = []
        try {
            const viewer: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'viewer'})
            const room: Room = await viewer.join('studio')
            const received: [string, PeerTrackEvent][] = []
            room.on('peer', (peer: Peer): void => void peer.on('track', (event: PeerTrackEvent): number => received.push([peer.id, event])))
            const publisher = await whipPublisher(clients, `${server.http}/whip/studio`, 0)
            stops.push(publisher.stop)
            assert.strictEqual(publisher.response.status, 201)
            await until((): boolean => received.length === 2, 20000, 'the tracks of the stream')
            //A member of its own id: the id of the session ends it, and is not given to the members
            const session: WHIPSession = server.whip!.sessions[0]
            assert.deepStrictEqual([session.room, session.connection, session.tracks], ['studio', undefined, undefined])
            assert.match(session.peerId!, /^whip:/)
            assert.ok(!session.peerId!.includes(session.id))
            assert.ok(publisher.location!.endsWith(`/${session.id}`))
            assert.deepStrictEqual(received.map(([id]: [string, PeerTrackEvent]): string => id), [session.peerId, session.peerId])
            const [, video] = received.find(([, event]: [string, PeerTrackEvent]): boolean => event.track.kind === 'video')!
            assert.deepStrictEqual(room.streamOf(video.streams[0].id), {id: video.streams[0].id, peerId: session.peerId, stream: 'broadcast'})
            assert.ok(await from(video.track, 0), 'the packets of the stream')
            assert.ok(server.sfu!.rooms().studio.members.includes(session.peerId!))
            //Its publisher deletes it: the member leaves
            const left: Promise<Peer> = next<Peer>((resolve: (peer: Peer) => void): unknown => room.on('peer-left', resolve), 10000, 'the stream leaving')
            assert.strictEqual((await fetch(`${server.http}${publisher.location}`, {method: 'DELETE'})).status, 200)
            assert.strictEqual((await left).id, session.peerId)
            //A room the server does not serve
            const refused = await whipPublisher(clients, `${server.http}/whip/lobby`, 100000)
            stops.push(refused.stop)
            assert.strictEqual(refused.response.status, 400)
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await clients.destroy()
            await server.stop()
        }
    })

    it('serves the rooms chosen, up to its members, with the tracks selected for each', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer({
            sfu: {
                serves: (room: string): boolean => room === 'meeting',
                maxMembers: 2,
                //bob receives nothing
                select: (subscriber): boolean => subscriber.peerId !== 'bob'
            }
        })
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            const alice: Member = await member(clients, server, 'alice', 0)
            const bob: Member = await member(clients, server, 'bob', 100000)
            members.push(alice, bob)
            await until((): boolean => alice.received.size === 1, 20000, 'the track of bob')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1000))
            assert.strictEqual(bob.received.size, 0)
            //Full
            const carol: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'carol'})
            await assert.rejects(carol.join('meeting'), {errno: 'E_SIGNALING_LIMIT'})
            //Another room stays peer to peer, published the same way
            const chat: Room = await carol.join('chat')
            const dave: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'dave'})
            const daveChat: Room = await dave.join('chat')
            assert.strictEqual(chat.sfu, undefined)
            const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
            const stop: () => void = feed(audio)
            members.push({room: chat, video: audio, received: new Map(), stop: stop})
            const received: Promise<PeerTrackEvent> = next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): void => {
                daveChat.on('peer', (peer: Peer): void => void peer.on('track', resolve))
            }, 20000, 'the audio of carol')
            await chat.publish(audio, 'microphone')
            const event: PeerTrackEvent = await received
            assert.deepStrictEqual(event.streams.map((stream: {id: string}): string => stream.id), ['microphone'])
            await packets(event.track, 5)
            //Paused between two members: the transceiver stops receiving, then receives again
            const peer: Peer = daveChat.peer('carol')!
            peer.pause(event.track)
            await until((): boolean => event.transceiver.currentDirection === 'inactive', 10000, 'the paused transceiver')
            peer.resume(event.track)
            await until((): boolean => event.transceiver.currentDirection === 'recvonly', 10000, 'the resumed transceiver')
            //Unpublished, then another track published on the same transceiver
            const connection: PeerConnection = chat.peer('dave')!.connection
            const transceivers: number = connection.getTransceivers().length
            await chat.unpublish(audio)
            await until((): boolean => connection.getTransceivers().some((transceiver: RtpTransceiver): boolean => transceiver.currentDirection === 'inactive'), 10000, 'the unpublished transceiver')
            const other: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
            members.push({room: chat, video: other, received: new Map(), stop: feed(other, 500000)})
            const again: Promise<PeerTrackEvent> = next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): unknown => peer.once('track', resolve), 20000, 'the other audio of carol')
            await chat.publish(other, 'microphone')
            assert.strictEqual((await again).transceiver, event.transceiver)
            assert.ok(await from((await again).track, 500000), 'the packets of the other audio')
            assert.strictEqual(connection.getTransceivers().length, transceivers)
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await server.stop()
        }
    })
})
