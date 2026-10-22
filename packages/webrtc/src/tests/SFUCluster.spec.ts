import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {Container} from '@lakutata/core'
import {MediaTrack} from '../peer/MediaTrack.js'
import {engineChannelOf} from '../peer/EngineConnection.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {PeerConnection, type PeerTrackEvent} from '../peer/PeerConnection.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {RtpPacket} from '../peer/RtpPacket.js'
import type {SFUNode, SFUOptions, SFUPlacement, SFUTrack} from '../sfu/SFU.js'
import {sfuRooms} from '../sfu/SFUAccess.js'
import type {SFURoom} from '../sfu/SFURoom.js'
import type {SignalingPeer} from '../protocol/SignalingProtocol.js'
import type {WHEPOptions} from '../whep/WHEP.js'
import type {WHIPOptions} from '../whip/WHIP.js'
import {feed, from, packets, whipPublisher} from './support/Media.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * A node of a cluster in the memory of the process
 */
type NodeOptions = {
    //No media server: a node of the signaling only
    signalingOnly?: boolean
    labels?: Record<string, string>
    sfu?: SFUOptions
    whip?: WHIPOptions
    whep?: WHEPOptions
}

/**
 * The nodes of a cluster in the memory of the process, each with the signaling and a media server, started at the same
 * time, once they all know each other
 * @param nodes The id of each node, and its options.
 */
async function startNodes(nodes: Record<string, NodeOptions>): Promise<TestServer[]> {
    const prefix: string = `test-${randomUUID()}`
    const servers: TestServer[] = await Promise.all(Object.entries(nodes).map(([id, options]: [string, NodeOptions]): Promise<TestServer> => startServer({
        cluster: {transport: {type: 'memory'}, prefix: prefix, nodeId: id, heartbeatInterval: 100, labels: options.labels ?? {}},
        ...options.signalingOnly ? {} : {sfu: options.sfu ?? {}},
        ...options.whip ? {whip: options.whip} : {},
        ...options.whep ? {whep: options.whep} : {}
    })))
    await until((): boolean => servers.every((server: TestServer): boolean => server.cluster!.nodes().length === servers.length), 5000, 'the nodes')
    //The media servers announced
    await until((): boolean => servers.every((server: TestServer): boolean => server.cluster!.nodes().filter((node): boolean => !!node.services.sfu).length === Object.values(nodes).filter((options: NodeOptions): boolean => !options.signalingOnly).length), 5000, 'the media servers')
    return servers
}

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
 * Join a room through a node and publish a video whose packets carry numbers from `first`
 * @param clients
 * @param server The node.
 * @param id
 * @param first
 * @param room
 */
async function member(clients: Container, server: TestServer, id: string, first: number, room: string = 'meeting'): Promise<Member> {
    const client: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: id})
    const joined: Room = await client.join(room)
    const received: Map<string, PeerTrackEvent[]> = new Map()
    joined.on('peer', (peer: Peer): void => {
        peer.on('track', (event: PeerTrackEvent): void => void received.set(peer.id, [...received.get(peer.id) ?? [], event]))
    })
    const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
    const stop: () => void = feed(video, first)
    await joined.publish(video, 'camera')
    return {room: joined, video: video, received: received, stop: stop}
}

/**
 * Stop the nodes left
 * @param servers
 */
async function stopAll(servers: TestServer[]): Promise<void> {
    await Promise.all(servers.map((server: TestServer): Promise<void> => server.stop().catch((): void => undefined)))
}

describe('SFU in a cluster', (): void => {

    it('keeps a room on the media server of one node, its members joining through any node', {timeout: 60000}, async (): Promise<void> => {
        const servers: TestServer[] = await startNodes({n0: {}, n1: {}, n2: {}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            //The first member through n1: the room goes to n1, the next members follow it
            members.push(await member(clients, servers[1], 'alice', 0))
            members.push(await member(clients, servers[0], 'bob', 100000))
            members.push(await member(clients, servers[2], 'carol', 200000))
            assert.deepStrictEqual(members.map((each: Member): string | undefined => each.room.sfu), ['sfu:n1', 'sfu:n1', 'sfu:n1'])
            for (const each of members) await until((): boolean => each.received.size === 2, 20000, 'the tracks of the others')
            const [alice, bob, carol] = members
            assert.ok(await from(alice.received.get('bob')![0].track, 100000), 'bob at alice')
            assert.ok(await from(bob.received.get('carol')![0].track, 200000), 'carol at bob')
            assert.ok(await from(carol.received.get('alice')![0].track, 0), 'alice at carol')
            assert.deepStrictEqual(Object.keys(servers[0].sfu!.rooms()), [])
            assert.deepStrictEqual(servers[1].sfu!.rooms().meeting.members.sort(), ['alice', 'bob', 'carol'])
            //Each member through its own node, with the media server it is connected to
            const peers = servers[0].signaling.rooms().meeting.sort()
            assert.deepStrictEqual(peers, ['alice', 'bob', 'carol', 'sfu:n1'])
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    it('gives the members of a full node another one, and the one selectSFU chooses', {timeout: 60000}, async (): Promise<void> => {
        const placements: SFUPlacement[] = []
        //The members whose id starts with a zone go to a node of that zone
        const selectSFU = (placement: SFUPlacement, nodes: SFUNode[]): string | undefined => {
            placements.push(placement)
            return nodes.find((node: SFUNode): boolean => node.labels.zone === placement.peerId.split('-')[0])?.id
        }
        const servers: TestServer[] = await startNodes({
            n0: {labels: {zone: 'eu'}, sfu: {maxMembers: 1, selectSFU: selectSFU}},
            n1: {labels: {zone: 'us'}, sfu: {maxMembers: 1, selectSFU: selectSFU}},
            n2: {labels: {zone: 'ap'}, sfu: {maxMembers: 1, selectSFU: selectSFU}}
        })
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            members.push(await member(clients, servers[0], 'us-alice', 0))
            assert.strictEqual(members[0].room.sfu, 'sfu:n1')
            assert.deepStrictEqual(placements[0], {room: 'meeting', peerId: 'us-alice', kind: 'member'})
            //n1 is full: a node with no member of the room takes the next one
            members.push(await member(clients, servers[1], 'us-bob', 100000))
            assert.notStrictEqual(members[1].room.sfu, 'sfu:n1')
            members.push(await member(clients, servers[2], 'carol', 200000))
            assert.deepStrictEqual(new Set(members.map((each: Member): string | undefined => each.room.sfu)), new Set(['sfu:n0', 'sfu:n1', 'sfu:n2']))
            //All full
            const dave: SignalingClient = await clients.get(SignalingClient, {url: servers[0].socketIO, id: 'dave'})
            await assert.rejects(dave.join('meeting'), {errno: 'E_SIGNALING_LIMIT'})
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    it('gives the members of a node without a media server the one of another node', {timeout: 60000}, async (): Promise<void> => {
        const servers: TestServer[] = await startNodes({n0: {signalingOnly: true}, n1: {}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            members.push(await member(clients, servers[0], 'alice', 0))
            members.push(await member(clients, servers[0], 'bob', 100000))
            assert.deepStrictEqual(members.map((each: Member): string | undefined => each.room.sfu), ['sfu:n1', 'sfu:n1'])
            for (const each of members) await until((): boolean => each.received.size === 1, 20000, 'the track of the other')
            assert.ok(await from(members[0].received.get('bob')![0].track, 100000), 'bob at alice')
            assert.ok(await from(members[1].received.get('alice')![0].track, 0), 'alice at bob')
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    it('moves the members of a media server whose node goes down to another one', {timeout: 90000}, async (): Promise<void> => {
        //The members go to n1 while it is there
        const selectSFU = (_placement: SFUPlacement, nodes: SFUNode[]): string | undefined => nodes.find((node: SFUNode): boolean => node.id === 'n1')?.id
        const servers: TestServer[] = await startNodes({n0: {sfu: {selectSFU: selectSFU}}, n1: {sfu: {selectSFU: selectSFU}}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            members.push(await member(clients, servers[0], 'alice', 0))
            members.push(await member(clients, servers[0], 'bob', 100000))
            const [alice, bob] = members
            assert.deepStrictEqual([alice.room.sfu, bob.room.sfu], ['sfu:n1', 'sfu:n1'])
            await until((): boolean => alice.received.size === 1 && bob.received.size === 1, 20000, 'the tracks')
            //n1 goes down: its members join the room again, on n0, and publish again
            await servers[1].stop()
            await until((): boolean => alice.room.sfu === 'sfu:n0' && bob.room.sfu === 'sfu:n0', 20000, 'the media server of n0')
            await until((): boolean => alice.received.get('bob')!.length === 2 && bob.received.get('alice')!.length === 2, 20000, 'the tracks again')
            assert.ok(await from(alice.received.get('bob')![1].track, 100000), 'bob at alice again')
            assert.ok(await from(bob.received.get('alice')![1].track, 0), 'alice at bob again')
            //The same peers, on the connection of the new media server
            assert.strictEqual(alice.room.peer('bob')!.connection.connectionState, 'connected')
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    for (const workers of [0, 2]) it(`forwards the tracks of a room between its nodes, each one once to each node wanting it${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (): Promise<void> => {
        //Each member on the node of its zone (the start of its id); bob does not receive carol
        const selectSFU = (placement: SFUPlacement, nodes: SFUNode[]): string | undefined => nodes.find((node: SFUNode): boolean => node.labels.zone === placement.peerId.split('-')[0])?.id
        const select = (subscriber: SignalingPeer, track: SFUTrack): boolean => !(subscriber.peerId === 'b-bob' && track.peerId === 'c-carol')
        const sfu: SFUOptions = {workers: workers, selectSFU: selectSFU, select: select}
        const servers: TestServer[] = await startNodes({n0: {labels: {zone: 'a'}, sfu: sfu}, n1: {labels: {zone: 'b'}, sfu: sfu}, n2: {labels: {zone: 'c'}, sfu: sfu}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            //Through other nodes than their own
            members.push(await member(clients, servers[1], 'a-alice', 0))
            members.push(await member(clients, servers[2], 'b-bob', 100000))
            members.push(await member(clients, servers[0], 'c-carol', 200000))
            members.push(await member(clients, servers[0], 'c-dave', 300000))
            const [alice, bob, carol, dave] = members
            assert.deepStrictEqual(members.map((each: Member): string | undefined => each.room.sfu), ['sfu:n0', 'sfu:n1', 'sfu:n2', 'sfu:n2'])
            await until((): boolean => alice.received.size === 3 && bob.received.size === 2 && carol.received.size === 3 && dave.received.size === 3, 30000, 'the tracks of the others')
            assert.ok(await from(alice.received.get('c-carol')![0].track, 200000), 'carol at alice')
            assert.ok(await from(alice.received.get('b-bob')![0].track, 100000), 'bob at alice')
            assert.ok(await from(carol.received.get('a-alice')![0].track, 0), 'alice at carol')
            assert.ok(await from(carol.received.get('c-dave')![0].track, 300000), 'dave at carol, on the same node')
            assert.ok(await from(bob.received.get('c-dave')![0].track, 300000), 'dave at bob')
            assert.ok(!bob.received.has('c-carol'), 'carol is not sent to bob')
            //The member, its stream and its track as on the node publishing it
            const event: PeerTrackEvent = dave.received.get('a-alice')![0]
            assert.deepStrictEqual(dave.room.streamOf(event.streams[0].id), {id: event.streams[0].id, peerId: 'a-alice', stream: 'camera'})
            if (!workers) {
                //Each track once to each node wanting it: alice once to n2 for carol and dave, carol not to n1
                const cascades = (index: number): Record<string, {sends: number, receives: number}> => (sfuRooms.get(servers[index].sfu!)!.get('meeting') as SFURoom).cascades()
                await until((): boolean => cascades(2)['sfu:n1']?.sends === 1, 10000, 'the tracks n2 sends to n1')
                assert.deepStrictEqual(cascades(0), {'sfu:n1': {sends: 1, receives: 1}, 'sfu:n2': {sends: 1, receives: 2}})
                assert.deepStrictEqual(cascades(1), {'sfu:n0': {sends: 1, receives: 1}, 'sfu:n2': {sends: 1, receives: 1}})
                assert.deepStrictEqual(cascades(2), {'sfu:n0': {sends: 2, receives: 1}, 'sfu:n1': {sends: 1, receives: 1}})
            }
            //Dave leaves: his video stops on the other nodes, n2 sends nothing more to n1
            const atAlice = alice.received.get('c-dave')![0].transceiver
            dave.stop()
            await dave.room.leave()
            members.pop()
            await until((): boolean => atAlice.currentDirection === 'inactive', 10000, 'the video of dave stopped at alice')
            if (!workers) await until((): boolean => (sfuRooms.get(servers[2].sfu!)!.get('meeting') as SFURoom).cascades()['sfu:n1']?.sends === 0, 10000, 'nothing sent to n1')
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    for (const workers of [0, 2]) it(`plays on a node a stream published with WHIP on another one, and reads it there${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (): Promise<void> => {
        const servers: TestServer[] = await startNodes({n0: {sfu: {workers: workers}, whip: {}, whep: {}}, n1: {sfu: {workers: workers}, whip: {}, whep: {}}})
        const clients: Container = new Container()
        const stops: (() => void)[] = []
        try {
            const publisher = await whipPublisher(clients, `${servers[0].http}/whip/live`, 500000)
            stops.push(publisher.stop)
            await until((): boolean => servers[0].sfu!.rooms().live?.tracks.length === 2, 10000, 'the tracks of the stream')
            const video: SFUTrack = servers[0].sfu!.rooms().live.tracks.find((track: SFUTrack): boolean => track.kind === 'video')!
            //A viewer of n1: n1 receives the stream from n0
            const viewer: PeerConnection = await clients.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1']})
            const tracks: Map<string, MediaTrack> = new Map()
            viewer.addEventListener('track', (event: PeerTrackEvent): unknown => tracks.set(event.track.kind, event.track))
            viewer.addTransceiver('audio', {direction: 'recvonly'})
            viewer.addTransceiver('video', {direction: 'recvonly'})
            await viewer.setLocalDescription()
            await until((): boolean => viewer.iceGatheringState === 'complete', 10000, 'the candidates')
            const response: Response = await fetch(`${servers[1].http}/whep/live`, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: viewer.localDescription!.sdp})
            assert.strictEqual(response.status, 201)
            await viewer.setRemoteDescription({type: 'answer', sdp: await response.text()})
            await until((): boolean => tracks.has('video'), 10000, 'the video of the viewer')
            assert.ok(await from(tracks.get('video')!, 500000), 'the stream at the viewer of n1')
            assert.strictEqual(servers[1].whep!.sessions[0].source, video.peerId)
            //Read on n1
            const read: MediaTrack | undefined = servers[1].sfu!.track('live', video.peerId, video.id)
            assert.ok(read, 'the track on n1')
            assert.ok((await packets(read!, 5)).every((packet: RtpPacket): boolean => packet.payload.readUInt32BE(0) >= 500000), 'the packets read on n1')
            viewer.close()
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    for (const workers of [0, 2]) it(`relays the data channels between members of different nodes, the sender waiting for a member receiving slowly${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (): Promise<void> => {
        const selectSFU = (placement: SFUPlacement, nodes: SFUNode[]): string | undefined => nodes.find((node: SFUNode): boolean => node.labels.zone === placement.peerId.split('-')[0])?.id
        const servers: TestServer[] = await startNodes({n0: {labels: {zone: 'a'}, sfu: {workers: workers, selectSFU: selectSFU}}, n1: {labels: {zone: 'b'}, sfu: {workers: workers, selectSFU: selectSFU}}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            members.push(await member(clients, servers[0], 'a-alice', 0))
            members.push(await member(clients, servers[0], 'b-bob', 100000))
            const [alice, bob] = members
            assert.deepStrictEqual([alice.room.sfu, bob.room.sfu], ['sfu:n0', 'sfu:n1'])
            //Bob echoes the messages of the channels he gets, and counts the bytes of bulk
            const opened: Map<string, PeerChannel> = new Map()
            const bulk: number[] = []
            bob.room.on('peer', (peer: Peer): void => void peer.on('datachannel', (channel: PeerChannel): void => {
                opened.set(channel.label, channel)
                if (channel.label === 'bulk') return void channel.on('message', (data: string | Buffer | ArrayBuffer): number => bulk.push((data as Buffer).readUInt32BE(0)))
                channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(typeof data === 'string' ? `echo: ${data}` : data as Buffer))
            }))
            await until((): boolean => !!alice.room.peer('b-bob'), 10000, 'the peer of bob')
            const toBob: PeerChannel = alice.room.peer('b-bob')!.createDataChannel('chat')
            await next<void>((resolve: () => void): unknown => toBob.once('open', resolve), 10000, 'the open channel')
            const echoed: Promise<unknown> = next<unknown>((resolve: (data: unknown) => void): unknown => toBob.once('message', resolve), 10000, 'the echo')
            toBob.send('hello')
            assert.strictEqual(await echoed, 'echo: hello')
            const binary: Promise<unknown> = next<unknown>((resolve: (data: unknown) => void): unknown => toBob.once('message', resolve), 10000, 'the binary echo')
            toBob.send(Buffer.from([1, 2, 3]))
            assert.deepStrictEqual(await binary, Buffer.from([1, 2, 3]))
            //Bob's side: the label, the id of alice as the protocol, the settings
            const chat: PeerChannel = opened.get('chat')!
            assert.deepStrictEqual([chat.protocol, chat.ordered, chat.maxRetransmits], ['a-alice', true, null])
            alice.room.peer('b-bob')!.createDataChannel('state', {ordered: false, maxRetransmits: 0})
            await until((): boolean => opened.has('state'), 10000, 'the unreliable channel')
            assert.deepStrictEqual([opened.get('state')!.ordered, opened.get('state')!.maxRetransmits], [false, 0])
            //Bob receives slowly (his receive window held): alice waits, the two servers keep a few megabytes
            const toBulk: PeerChannel = alice.room.peer('b-bob')!.createDataChannel('bulk')
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
            assert.ok(toBulk.bufferedAmount > 6 * 1024 * 1024, `alice has ${toBulk.bufferedAmount} bytes waiting`)
            //Bob reads again: everything arrives, in order
            window.releaseReceived(1 << 30)
            await until((): boolean => bulk.length === count, 30000, 'the bulk messages')
            assert.ok(bulk.every((index: number, position: number): boolean => index === position))
            //Closed by alice: closed for bob
            const closed: Promise<void> = next<void>((resolve: () => void): unknown => chat.once('close', resolve), 10000, 'the closed channel')
            toBob.close()
            await closed
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })

    it('keeps a channel to a member not known yet until it joins, and closes it when it does not', {timeout: 60000}, async (): Promise<void> => {
        const selectSFU = (placement: SFUPlacement, nodes: SFUNode[]): string | undefined => nodes.find((node: SFUNode): boolean => node.labels.zone === placement.peerId.split('-')[0])?.id
        const servers: TestServer[] = await startNodes({n0: {labels: {zone: 'a'}, sfu: {selectSFU: selectSFU}}, n1: {labels: {zone: 'b'}, sfu: {selectSFU: selectSFU}}})
        const clients: Container = new Container()
        const members: Member[] = []
        try {
            members.push(await member(clients, servers[0], 'a-alice', 0))
            members.push(await member(clients, servers[1], 'b-bob', 100000))
            const [alice] = members
            await until((): boolean => !!alice.room.peer('b-bob'), 10000, 'the peer of bob')
            //Channels opened on the connection to the server, to members not in the room yet: carol, then nobody
            const connection: PeerConnection = alice.room.peer('b-bob')!.connection
            const toCarol: PeerChannel = connection.createDataChannel('early', {protocol: 'b-carol'})
            const toNobody: PeerChannel = connection.createDataChannel('lost', {protocol: 'b-nobody'})
            await next<void>((resolve: () => void): unknown => toCarol.once('open', resolve), 10000, 'the channel to carol')
            toCarol.send('before carol joined')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            const carol: SignalingClient = await clients.get(SignalingClient, {url: servers[1].socketIO, id: 'b-carol'})
            const received: Promise<[PeerChannel, unknown]> = next<[PeerChannel, unknown]>((resolve: (value: [PeerChannel, unknown]) => void): void => {
                void carol.join('meeting').then((room: Room): void => void room.on('peer', (peer: Peer): void => void peer.on('datachannel', (channel: PeerChannel): void => {
                    channel.once('message', (data: string | Buffer | ArrayBuffer): void => resolve([channel, data]))
                })))
            }, 20000, 'the channel at carol')
            const [channel, data] = await received
            assert.deepStrictEqual([channel.label, channel.protocol, data], ['early', 'a-alice', 'before carol joined'])
            await next<void>((resolve: () => void): unknown => toNobody.once('close', resolve), 10000, 'the channel to nobody closed')
        } finally {
            members.forEach((each: Member): void => each.stop())
            await clients.destroy()
            await stopAll(servers)
        }
    })
})
