import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {io as connect, type Socket} from 'socket.io-client'
import {Container} from '@lakutata/core'
import {Cluster, type ClusterNode} from '../cluster/Cluster.js'
import {SignalingEvent, SignalingMethod, type SignalingPeer} from '../protocol/SignalingProtocol.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {SignalingOptions} from '../signaling/Signaling.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * The nodes of a cluster in the memory of the process, started one after the other (the options of a registration are
 * kept on its class, shared by the containers), once they all know each other
 * @param ids
 * @param signaling
 */
async function startNodes(ids: string[], signaling: SignalingOptions = {}): Promise<TestServer[]> {
    const prefix: string = `test-${randomUUID()}`
    const servers: TestServer[] = []
    for (const id of ids) servers.push(await startServer({cluster: {transport: {type: 'memory'}, prefix: prefix, nodeId: id, heartbeatInterval: 100}, signaling: signaling}))
    await until((): boolean => servers.every((server: TestServer): boolean => server.cluster!.nodes().length === ids.length), 5000, 'the nodes')
    return servers
}

/**
 * A raw Socket.IO client of the signaling, recording the events it gets
 * @param server
 * @param id
 */
async function rawClient(server: TestServer, id: string): Promise<Socket & {events: [string, any][]}> {
    const socket: Socket = connect(server.socketIO, {auth: {id: id}, transports: ['websocket'], reconnection: false})
    const events: [string, any][] = []
    socket.onAny((event: string, payload: unknown): number => events.push([event, payload]))
    await next<void>((resolve: () => void): unknown => socket.once('connect', resolve), 5000, 'the connection')
    return Object.assign(socket, {events: events})
}

/**
 * A request of a raw client
 * @param socket
 * @param method
 * @param params
 */
function request(socket: Socket, method: string, params: Record<string, unknown> = {}): Promise<any> {
    return socket.timeout(5000).emitWithAck('message', {...params, method: method})
}

/**
 * The rooms of a node and their members, sorted
 * @param server
 */
function roomsOf(server: TestServer): Record<string, string[]> {
    return Object.fromEntries(Object.entries(server.signaling.rooms()).sort(([x]: [string, string[]], [y]: [string, string[]]): number => x.localeCompare(y)).map(([room, members]: [string, string[]]): [string, string[]] => [room, [...members].sort()]))
}

/**
 * The events of a kind a raw client got
 * @param socket
 * @param event
 */
function eventsOf(socket: Socket & {events: [string, any][]}, event: string): any[] {
    return socket.events.filter(([name]: [string, any]): boolean => name === event).map(([, payload]: [string, any]): any => payload)
}

describe('Signaling in a cluster', (): void => {

    it('puts the members connected to different nodes in the same rooms, and passes their signals', {timeout: 30000}, async (): Promise<void> => {
        const [a, b, c] = await startNodes(['a', 'b', 'c'])
        const sockets: Socket[] = []
        try {
            const alice = await rawClient(a, 'alice')
            const bob = await rawClient(b, 'bob')
            const carol = await rawClient(c, 'carol')
            sockets.push(alice, bob, carol)
            assert.deepStrictEqual((await request(alice, SignalingMethod.join, {room: 'meeting', metadata: {name: 'Alice'}, session: 's-alice'})).payload.peers, [])
            //The members of the other nodes are in the join result, and told of the newcomer
            const joined: any = await request(bob, SignalingMethod.join, {room: 'meeting', metadata: {name: 'Bob'}, session: 's-bob'})
            assert.deepStrictEqual(joined.payload.peers, [{peerId: 'alice', metadata: {name: 'Alice'}, session: 's-alice'}])
            await until((): boolean => eventsOf(alice, SignalingEvent.peerJoined).length === 1, 5000, 'peer-joined')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.peerJoined), [{room: 'meeting', peerId: 'bob', metadata: {name: 'Bob'}, session: 's-bob'}])
            for (const server of [a, b, c]) assert.deepStrictEqual(roomsOf(server), {meeting: ['alice', 'bob']})
            //A signal to a member of another node
            assert.deepStrictEqual((await request(alice, SignalingMethod.signal, {room: 'meeting', to: 'bob', description: {type: 'offer', sdp: 'v=0'}})).payload, {delivered: true})
            await until((): boolean => eventsOf(bob, SignalingEvent.signal).length === 1, 5000, 'the signal')
            assert.deepStrictEqual(eventsOf(bob, SignalingEvent.signal), [{room: 'meeting', from: 'alice', session: 's-alice', description: {type: 'offer', sdp: 'v=0'}}])
            //In the order sent
            for (let index: number = 0; index < 20; index++) {
                void request(bob, SignalingMethod.signal, {room: 'meeting', to: 'alice', candidate: {candidate: `candidate:${index} 1 udp 1 127.0.0.1 ${1000 + index} typ host`, sdpMid: '0'}})
            }
            await until((): boolean => eventsOf(alice, SignalingEvent.signal).length === 20, 5000, 'the candidates')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.signal).map((event: any): number => Number(/^candidate:(\d+)/.exec(event.candidate.candidate)![1])), [...Array(20).keys()])
            //A third member: the members of the other nodes stay (a node pushes to its own members only)
            const third: any = await request(carol, SignalingMethod.join, {room: 'meeting'})
            assert.deepStrictEqual(third.payload.peers.map((peer: SignalingPeer): string => peer.peerId).sort(), ['alice', 'bob'])
            await until((): boolean => eventsOf(alice, SignalingEvent.peerJoined).length === 2 && eventsOf(bob, SignalingEvent.peerJoined).length === 1, 5000, 'peer-joined')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            for (const server of [a, b, c]) assert.deepStrictEqual(roomsOf(server), {meeting: ['alice', 'bob', 'carol']})
            assert.deepStrictEqual((await request(carol, SignalingMethod.signal, {room: 'meeting', to: 'alice', description: {type: 'answer', sdp: 'v=0'}})).payload, {delivered: true})
            //Not a member
            const stranger = await rawClient(a, 'stranger')
            sockets.push(stranger)
            assert.strictEqual((await request(stranger, SignalingMethod.signal, {room: 'meeting', to: 'bob', description: {type: 'offer', sdp: 'v=0'}})).error?.errno, 'E_SIGNALING_NOT_A_MEMBER')
            assert.strictEqual((await request(alice, SignalingMethod.signal, {room: 'meeting', to: 'nobody', description: {type: 'offer', sdp: 'v=0'}})).error?.errno, 'E_SIGNALING_NOT_A_MEMBER')
            //Leaving, disconnecting: the members of the other nodes are told
            assert.strictEqual((await request(bob, SignalingMethod.leave, {room: 'meeting'})).success, true)
            carol.disconnect()
            await until((): boolean => eventsOf(alice, SignalingEvent.peerLeft).length === 2, 5000, 'peer-left')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.peerLeft).sort((x: any, y: any): number => x.peerId.localeCompare(y.peerId)), [
                {room: 'meeting', peerId: 'bob', reason: 'left'},
                {room: 'meeting', peerId: 'carol', reason: 'disconnected'}
            ])
            await until((): boolean => [a, b, c].every((server: TestServer): boolean => JSON.stringify(roomsOf(server)) === JSON.stringify({meeting: ['alice']})), 5000, 'the rooms')
        } finally {
            for (const socket of sockets) socket.disconnect()
            for (const server of [a, b, c]) await server.stop()
        }
    })

    it('takes out the members of a node going down, and fetches the members of a node coming up', {timeout: 30000}, async (): Promise<void> => {
        const [a, b] = await startNodes(['a', 'b'])
        const sockets: Socket[] = []
        let late: TestServer | undefined
        try {
            const alice = await rawClient(a, 'alice')
            const bob = await rawClient(b, 'bob')
            sockets.push(alice, bob)
            await request(alice, SignalingMethod.join, {room: 'x', session: 's-alice'})
            await request(alice, SignalingMethod.join, {room: 'y', metadata: 'Alice'})
            await request(bob, SignalingMethod.join, {room: 'x'})
            await until((): boolean => roomsOf(a).x?.length === 2, 5000, 'bob')
            //A node coming up later gets the members of the others
            late = await startServer({cluster: {transport: {type: 'memory'}, prefix: (a.cluster as unknown as {prefix: string}).prefix, nodeId: 'late', heartbeatInterval: 100}})
            await until((): boolean => JSON.stringify(roomsOf(late!)) === JSON.stringify({x: ['alice', 'bob'], y: ['alice']}), 5000, 'the members of the others')
            const carol = await rawClient(late, 'carol')
            sockets.push(carol)
            //The session of a member is the one of its client, in all its rooms
            assert.deepStrictEqual((await request(carol, SignalingMethod.join, {room: 'y'})).payload.peers, [{peerId: 'alice', metadata: 'Alice', session: 's-alice'}])
            //A node going down: its members leave their rooms, disconnected
            await b.stop()
            await until((): boolean => eventsOf(alice, SignalingEvent.peerLeft).length === 1, 5000, 'peer-left')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.peerLeft), [{room: 'x', peerId: 'bob', reason: 'disconnected'}])
            await until((): boolean => JSON.stringify(roomsOf(late!)) === JSON.stringify({x: ['alice'], y: ['alice', 'carol']}), 5000, 'the rooms')
            assert.deepStrictEqual(roomsOf(a), {x: ['alice'], y: ['alice', 'carol']})
        } finally {
            for (const socket of sockets) socket.disconnect()
            for (const server of [a, b, late]) await server?.stop()
        }
    })

    it('moves a member joining again through another node, without telling the others it left', {timeout: 30000}, async (): Promise<void> => {
        const [a, b, c] = await startNodes(['a', 'b', 'c'])
        const sockets: Socket[] = []
        try {
            const first = await rawClient(a, 'dave')
            const carol = await rawClient(c, 'carol')
            sockets.push(first, carol)
            await request(carol, SignalingMethod.join, {room: 'room'})
            await request(first, SignalingMethod.join, {room: 'room', session: 's-dave'})
            await until((): boolean => eventsOf(carol, SignalingEvent.peerJoined).length === 1, 5000, 'peer-joined')
            //Its client reconnects through another node before the first connection closed
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 5))
            const second = await rawClient(b, 'dave')
            sockets.push(second)
            const joined: any = await request(second, SignalingMethod.join, {room: 'room', session: 's-dave'})
            assert.deepStrictEqual(joined.payload.peers, [{peerId: 'carol'}])
            await until((): boolean => eventsOf(carol, SignalingEvent.peerJoined).length === 2, 5000, 'peer-joined')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            assert.deepStrictEqual(eventsOf(carol, SignalingEvent.peerLeft), [])
            for (const server of [a, b, c]) assert.deepStrictEqual(roomsOf(server), {room: ['carol', 'dave']})
            //The signals go to the new connection
            assert.deepStrictEqual((await request(carol, SignalingMethod.signal, {room: 'room', to: 'dave', description: {type: 'offer', sdp: 'v=0'}})).payload, {delivered: true})
            await until((): boolean => eventsOf(second, SignalingEvent.signal).length === 1, 5000, 'the signal')
            assert.deepStrictEqual(eventsOf(first, SignalingEvent.signal), [])
            //The first connection closing does not take it out
            first.disconnect()
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            assert.deepStrictEqual(eventsOf(carol, SignalingEvent.peerLeft), [])
            assert.deepStrictEqual(roomsOf(c), {room: ['carol', 'dave']})
        } finally {
            for (const socket of sockets) socket.disconnect()
            for (const server of [a, b, c]) await server.stop()
        }
    })

    it('counts the members of a room over the whole cluster', {timeout: 30000}, async (): Promise<void> => {
        const servers: TestServer[] = await startNodes(['a', 'b', 'c', 'd'], {maxPeers: 2})
        const sockets: Socket[] = []
        try {
            for (let round: number = 0; round < 3; round++) {
                const clients = await Promise.all(servers.map((server: TestServer, index: number) => rawClient(server, `m${round}-${index}`)))
                sockets.push(...clients)
                const results: any[] = await Promise.all(clients.map((client: Socket): Promise<any> => request(client, SignalingMethod.join, {room: `full-${round}`})))
                assert.strictEqual(results.filter((result: any): boolean => result.success).length, 2, JSON.stringify(results))
                assert.ok(results.filter((result: any): boolean => !result.success).every((result: any): boolean => result.error?.errno === 'E_SIGNALING_LIMIT'))
            }
            //A place freed is taken again
            const room: string[] = servers[0].signaling.rooms()['full-0']
            const leaving = sockets.find((socket: Socket): boolean => (socket as unknown as {auth: {id: string}}).auth.id === room[0])!
            await request(leaving, SignalingMethod.leave, {room: 'full-0'})
            await until((): boolean => servers.every((server: TestServer): boolean => server.signaling.rooms()['full-0']?.length === 1), 5000, 'the place')
            const newcomer = await rawClient(servers[3], 'newcomer')
            sockets.push(newcomer)
            assert.strictEqual((await request(newcomer, SignalingMethod.join, {room: 'full-0'})).success, true)
        } finally {
            for (const socket of sockets) socket.disconnect()
            for (const server of servers) await server.stop()
        }
    })

    it('fetches the members of a node again when changes of it were missed', {timeout: 30000}, async (): Promise<void> => {
        const [a] = await startNodes(['a'])
        const prefix: string = (a.cluster as unknown as {prefix: string}).prefix
        //A node whose changes are written by hand
        const container: Container = new Container()
        const fake: Cluster = await container.setNamed<Cluster>('cluster', Cluster, {transport: {type: 'memory'}, prefix: prefix, nodeId: 'fake', heartbeatInterval: 100})
        let snapshot: {seq: number, members: Record<string, unknown>[]} = {seq: 0, members: []}
        fake.handle('webrtc.signaling.snapshot', (): unknown => snapshot)
        const sockets: Socket[] = []
        try {
            const alice = await rawClient(a, 'alice')
            sockets.push(alice)
            await request(alice, SignalingMethod.join, {room: 'r'})
            await until((): boolean => a.cluster!.nodes().some((node: ClusterNode): boolean => node.id === 'fake'), 5000, 'the fake node')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
            const ghost = (peerId: string): Record<string, unknown> => ({room: 'r', peerId: peerId, joinedAt: 1})
            fake.publish('webrtc.signaling.membership', {kind: 'join', seq: 1, ...ghost('ghost1')})
            await until((): boolean => roomsOf(a).r.length === 2, 5000, 'ghost1')
            //Change 2 lost: change 3 makes the node fetch the members
            snapshot = {seq: 3, members: [ghost('ghost2'), ghost('ghost3')]}
            fake.publish('webrtc.signaling.membership', {kind: 'join', seq: 3, ...ghost('ghost3')})
            await until((): boolean => JSON.stringify(roomsOf(a)) === JSON.stringify({r: ['alice', 'ghost2', 'ghost3']}), 5000, 'the members fetched')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.peerLeft), [{room: 'r', peerId: 'ghost1', reason: 'disconnected'}])
            //The last change lost: the number in its heartbeat makes the node fetch the members
            snapshot = {seq: 4, members: [ghost('ghost3')]}
            fake.announce('signaling', {seq: 4})
            await until((): boolean => JSON.stringify(roomsOf(a)) === JSON.stringify({r: ['alice', 'ghost3']}), 5000, 'the members fetched again')
            assert.deepStrictEqual(eventsOf(alice, SignalingEvent.peerJoined).map((event: any): string => event.peerId), ['ghost1', 'ghost2', 'ghost3'])
        } finally {
            for (const socket of sockets) socket.disconnect()
            await container.destroy()
            await a.stop()
        }
    })

    it('connects two applications through different nodes, a data channel between them', {timeout: 60000}, async (): Promise<void> => {
        const [a, b] = await startNodes(['a', 'b'])
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: a.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: b.jsonRPC, id: 'bob'})
            const first: Room = await alice.join('lobby')
            const second: Room = await bob.join('lobby')
            first.on('peer', (peer: Peer): void => {
                peer.on('datachannel', (channel: PeerChannel): void => {
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
                })
            })
            const echo: string = await next<string>((resolve: (value: string) => void): void => {
                second.on('peer', (peer: Peer): void => {
                    const channel: PeerChannel = peer.createDataChannel('chat')
                    channel.on('open', (): void => channel.send('hello'))
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
                })
            }, 20000, 'the echo')
            assert.strictEqual(echo, 'echo: hello')
        } finally {
            await clients.destroy()
            await a.stop()
            await b.stop()
        }
    })
})
