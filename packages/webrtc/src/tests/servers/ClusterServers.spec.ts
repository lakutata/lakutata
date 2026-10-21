import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {io as connect, type Socket} from 'socket.io-client'
import {Container} from '@lakutata/core'
import {Cluster, type ClusterOptions, type ClusterReply, type ClusterTransportOptions} from '../../cluster/Cluster.js'
import {SignalingEvent, SignalingMethod} from '../../protocol/SignalingProtocol.js'
import {next, startServer, type TestServer, until} from '../support/Server.js'

/**
 * The servers of the tests (test-env/cluster.sh starts them in Docker): the transport, and the container to restart
 */
const SERVERS: {name: string, transport: ClusterTransportOptions, container?: string}[] = [
    ...process.env.WEBRTC_TEST_NATS ? [{name: 'NATS', transport: {type: 'nats', servers: process.env.WEBRTC_TEST_NATS} as ClusterTransportOptions, container: process.env.WEBRTC_TEST_NATS_CONTAINER}] : [],
    ...process.env.WEBRTC_TEST_REDIS ? [{name: 'Redis', transport: {type: 'redis', url: process.env.WEBRTC_TEST_REDIS} as ClusterTransportOptions, container: process.env.WEBRTC_TEST_REDIS_CONTAINER}] : []
]

if (!SERVERS.length) describe('The cluster on NATS and Redis', {skip: 'test-env/cluster.sh runs it with the servers in Docker'}, (): void => undefined)

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
    return socket.timeout(10000).emitWithAck('message', {...params, method: method})
}

/**
 * The members of a room a raw client sees: the ones of its join result, then the events it got
 * @param socket
 * @param peers
 */
function presentFor(socket: Socket & {events: [string, any][]}, peers: string[]): string[] {
    const present: Set<string> = new Set(peers)
    for (const [event, payload] of socket.events) {
        if (event === SignalingEvent.peerJoined) present.add(payload.peerId)
        if (event === SignalingEvent.peerLeft) present.delete(payload.peerId)
    }
    return [...present].sort()
}

/**
 * The members of a room on a node, sorted
 * @param server
 * @param room
 */
function membersOf(server: TestServer, room: string): string[] {
    return [...server.signaling.rooms()[room] ?? []].sort()
}

for (const {name, transport, container} of SERVERS) {

    /**
     * The options of a node of a cluster on the server
     * @param prefix
     * @param nodeId
     */
    const nodeOptions = (prefix: string, nodeId: string): ClusterOptions => ({transport: transport, prefix: prefix, nodeId: nodeId, heartbeatInterval: 500})

    describe(`The cluster on ${name}`, (): void => {

        it('finds the nodes, sends messages of any size and answers requests', {timeout: 60000}, async (): Promise<void> => {
            const prefix: string = `test-${randomUUID().slice(0, 8)}`
            const containers: Container[] = [new Container(), new Container()]
            try {
                //One after the other: the options of a registration are kept on its class, shared by the containers
                const a: Cluster = await containers[0].setNamed<Cluster>('cluster', Cluster, nodeOptions(prefix, 'a'))
                const b: Cluster = await containers[1].setNamed<Cluster>('cluster', Cluster, nodeOptions(prefix, 'b'))
                await until((): boolean => a.nodes().length === 2 && b.nodes().length === 2, 10000, 'the nodes')
                //More than a message of the server carries: sent in parts
                const large: string = 'x'.repeat(3 * 1024 * 1024)
                const received: Promise<string> = next<string>((resolve: (message: string) => void): unknown => b.subscribe<string>('large', resolve), 20000, 'the large message')
                a.publish('large', large)
                assert.strictEqual(await received, large)
                b.handle<{n: number}, number>('double', ({n}: {n: number}): number => n * 2)
                assert.strictEqual(await a.request<number>('b', 'double', {n: 21}), 42)
                const replies: ClusterReply<number>[] = await a.requestAll<number>('double', {n: 5})
                assert.deepStrictEqual(replies, [{node: 'b', result: 10}])
                //Another prefix on the same server is another cluster
                const other: Container = new Container()
                containers.push(other)
                const apart: Cluster = await other.setNamed<Cluster>('cluster', Cluster, nodeOptions(`test-${randomUUID().slice(0, 8)}`, 'apart'))
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1500))
                assert.deepStrictEqual(apart.nodes().map((node): string => node.id), ['apart'])
                assert.strictEqual(a.nodes().length, 2)
            } finally {
                for (const each of containers) await each.destroy()
            }
        })

        it('gives a node coming up the members of the others, more than a megabyte of them', {timeout: 60000}, async (): Promise<void> => {
            const prefix: string = `test-${randomUUID().slice(0, 8)}`
            const a: TestServer = await startServer({cluster: nodeOptions(prefix, 'a')})
            let b: TestServer | undefined
            try {
                //Members added by the application, each alone in its room (no client to push to)
                for (let index: number = 0; index < 1500; index++) await a.signaling.join(`member-${index}`, `room-${index}`, {metadata: 'm'.repeat(1000)})
                b = await startServer({cluster: nodeOptions(prefix, 'b')})
                await until((): boolean => Object.keys(b!.signaling.rooms()).length === 1500, 20000, 'the members of the node a')
                assert.deepStrictEqual(b.signaling.rooms()['room-1499'], ['member-1499'])
            } finally {
                await b?.stop()
                await a.stop()
            }
        })

        it('shares the rooms again once the server comes back', {timeout: 120000, skip: !container && 'needs the container of the server'}, async (): Promise<void> => {
            const prefix: string = `test-${randomUUID().slice(0, 8)}`
            const a: TestServer = await startServer({cluster: nodeOptions(prefix, 'a')})
            const b: TestServer = await startServer({cluster: nodeOptions(prefix, 'b')})
            const sockets: Socket[] = []
            try {
                await until((): boolean => a.cluster!.nodes().length === 2 && b.cluster!.nodes().length === 2, 10000, 'the nodes')
                const alice = await rawClient(a, 'alice')
                const carol = await rawClient(a, 'carol')
                const bob = await rawClient(b, 'bob')
                sockets.push(alice, carol, bob)
                const joins: Record<string, string[]> = {}
                for (const [socket, id] of [[alice, 'alice'], [carol, 'carol'], [bob, 'bob']] as [Socket, string][]) {
                    joins[id] = (await request(socket, SignalingMethod.join, {room: 'room'})).payload.peers.map((peer: {peerId: string}): string => peer.peerId)
                }
                await until((): boolean => membersOf(a, 'room').length === 3 && membersOf(b, 'room').length === 3, 10000, 'the members')
                //The server restarted (the messages meanwhile are lost); the members change while it is away
                const restarted: Promise<unknown> = promisify(execFile)('docker', ['restart', '-t', '0', container!])
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
                await request(alice, SignalingMethod.leave, {room: 'room'})
                const dave = await rawClient(b, 'dave')
                sockets.push(dave)
                joins.dave = (await request(dave, SignalingMethod.join, {room: 'room'})).payload.peers.map((peer: {peerId: string}): string => peer.peerId)
                await restarted
                //The nodes agree again, and tell their members
                const expected: string[] = ['bob', 'carol', 'dave']
                await until((): boolean => JSON.stringify(membersOf(a, 'room')) === JSON.stringify(expected) && JSON.stringify(membersOf(b, 'room')) === JSON.stringify(expected), 60000, 'the rooms shared again')
                await until((): boolean => JSON.stringify(presentFor(carol, joins.carol)) === JSON.stringify(['bob', 'dave']), 20000, 'the members carol sees')
                assert.deepStrictEqual(presentFor(bob, joins.bob), ['carol', 'dave'])
                assert.deepStrictEqual(presentFor(dave, joins.dave), ['bob', 'carol'])
                //The signals go through again
                assert.deepStrictEqual((await request(carol, SignalingMethod.signal, {room: 'room', to: 'dave', description: {type: 'offer', sdp: 'v=0'}})).payload, {delivered: true})
            } finally {
                for (const socket of sockets) socket.disconnect()
                await b.stop()
                await a.stop()
            }
        })
    })
}
