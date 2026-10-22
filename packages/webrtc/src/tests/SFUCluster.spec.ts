import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {Container} from '@lakutata/core'
import {MediaTrack} from '../peer/MediaTrack.js'
import type {PeerTrackEvent} from '../peer/PeerConnection.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {SFUNode, SFUOptions, SFUPlacement} from '../sfu/SFU.js'
import {feed, from} from './support/Media.js'
import {startServer, type TestServer, until} from './support/Server.js'

/**
 * A node of a cluster in the memory of the process
 */
type NodeOptions = {
    //No media server: a node of the signaling only
    signalingOnly?: boolean
    labels?: Record<string, string>
    sfu?: SFUOptions
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
        ...options.signalingOnly ? {} : {sfu: options.sfu ?? {}}
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
})
