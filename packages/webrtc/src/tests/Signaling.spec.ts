import {describe, it} from 'node:test'
import assert from 'node:assert'
import {io as connect, type Socket} from 'socket.io-client'
import {Container} from '@lakutata/core'
import {SignalingEvent, SignalingMethod, type SignalingJoinResult, type SignalingStream} from '../protocol/SignalingProtocol.js'
import {SignalingLimitException} from '../exceptions/SignalingLimitException.js'
import {mediaServers} from '../signaling/MediaServers.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import {PeerThreads} from '../peer/PeerThreads.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import {SignalingSession} from '../shared/SignalingSession.js'
import {JSONRPCTransport, SocketIOTransport, type SocketIOSocketLike, type WebSocketLike} from '../shared/Transports.js'
import type {Peer as SharedPeer} from '../shared/Peer.js'
import type {Room as SharedRoom} from '../shared/Room.js'
import type {PeerConnectionConfiguration} from '../shared/Connections.js'
import {next, startServer, type TestServer, until} from './support/Server.js'
import {WebSocket as PackageWebSocket} from 'ws'

/**
 * The WebSocket of a member over JSON-RPC: the global one, else the one of the package ws (Node.js 18 to 21)
 */
const MemberWebSocket: typeof WebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket ?? PackageWebSocket as unknown as typeof WebSocket

/**
 * The listeners of a stand-in socket
 */
class StandInListeners {
    readonly #listeners: Map<string, Set<(...args: any[]) => void>> = new Map()

    public on(event: string, listener: (...args: any[]) => void): void {
        if (!this.#listeners.has(event)) this.#listeners.set(event, new Set())
        this.#listeners.get(event)!.add(listener)
    }

    public off(event: string, listener?: (...args: any[]) => void): void {
        if (listener) this.#listeners.get(event)?.delete(listener)
    }

    public fire(event: string, ...args: any[]): void {
        for (const listener of [...this.#listeners.get(event) ?? []]) listener(...args)
    }
}

/**
 * A Socket.IO socket standing in for socket.io-client: its emits are kept, its events fired by the test
 */
class StandInSocketIO extends StandInListeners implements SocketIOSocketLike {
    public connected: boolean = true

    public readonly emitted: any[][] = []

    public emit(_event: string, ...args: any[]): void {
        this.emitted.push(args)
    }
}

/**
 * A WebSocket standing in for a connection to the server: its messages are kept, its events fired by the test
 */
class StandInWebSocket extends StandInListeners implements WebSocketLike {
    public readyState: number = 0

    public readonly sent: string[] = []

    public send(data: string): void {
        this.sent.push(data)
    }

    public close(): void {
        this.readyState = 3
    }

    public addEventListener(type: string, listener: (event: any) => void): void {
        this.on(type, listener)
    }

    public removeEventListener(type: string, listener: (event: any) => void): void {
        this.off(type, listener)
    }
}

/**
 * Two members of a room: the second one opens a channel, the first one echoes its messages
 * @param first
 * @param second
 */
async function echoBetween(first: Room, second: Room): Promise<string> {
    first.on('peer', (peer: Peer): void => {
        peer.on('datachannel', (channel: PeerChannel): void => {
            channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
        })
    })
    return await next<string>((resolve: (value: string) => void): void => {
        second.on('peer', (peer: Peer): void => {
            const channel: PeerChannel = peer.createDataChannel('chat')
            channel.on('open', (): void => channel.send('hello'))
            channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
        })
    }, 20000, 'the echo')
}

/**
 * A raw Socket.IO client of the signaling
 * @param server
 * @param id
 */
async function rawClient(server: TestServer, id: string): Promise<Socket> {
    const socket: Socket = connect(server.socketIO, {auth: {id: id}, transports: ['websocket'], reconnection: false})
    await next<void>((resolve: () => void): unknown => socket.once('connect', resolve), 5000, 'the connection')
    return socket
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

describe('Signaling', (): void => {

    it('connects two applications over Socket.IO, a data channel between them', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
            const first: Room = await alice.join('lobby', {metadata: {name: 'Alice'}})
            const second: Room = await bob.join('lobby', {metadata: {name: 'Bob'}})
            assert.deepStrictEqual(server.signaling.rooms(), {lobby: ['alice', 'bob']})
            assert.strictEqual(await echoBetween(first, second), 'echo: hello')
            //The metadata of the other member, the polite side by the ids
            assert.deepStrictEqual(second.peer('alice')?.metadata, {name: 'Alice'})
            assert.deepStrictEqual(first.peer('bob')?.metadata, {name: 'Bob'})
            assert.strictEqual(first.peer('bob')?.polite, true)
            assert.strictEqual(second.peer('alice')?.polite, false)
            //Leaving closes the peer of the other side
            const left: Promise<Peer> = next<Peer>((resolve: (peer: Peer) => void): unknown => first.on('peer-left', resolve), 10000, 'peer-left')
            await second.leave()
            assert.strictEqual((await left).id, 'bob')
            assert.deepStrictEqual(server.signaling.rooms(), {lobby: ['alice']})
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('connects two applications over JSON-RPC (WebSocket)', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'bob'})
            const first: Room = await alice.join('lobby')
            const second: Room = await bob.join('lobby')
            assert.strictEqual(await echoBetween(first, second), 'echo: hello')
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('connects over JSON-RPC with the package ws where there is no global WebSocket (Node.js 18 to 21)', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const global: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
        Reflect.deleteProperty(globalThis, 'WebSocket')
        try {
            assert.strictEqual((globalThis as { WebSocket?: unknown }).WebSocket, undefined)
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'bob'})
            const first: Room = await alice.join('lobby')
            const second: Room = await bob.join('lobby')
            assert.strictEqual(await echoBetween(first, second), 'echo: hello')
        } finally {
            if (global) Object.defineProperty(globalThis, 'WebSocket', global)
            await clients.destroy()
            await server.stop()
        }
    })

    for (const threads of [false, true]) it(`connects a Socket.IO member and a JSON-RPC member, through the TURN relay only${threads ? ', their connections served in worker threads' : ''}`, {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer({turn: {secret: 'test-secret'}})
        const clients: Container = new Container()
        try {
            if (threads) await clients.setNamed('threads', PeerThreads, {threads: 2})
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice', iceTransportPolicy: 'relay', ...threads ? {threads: 'threads'} : {}})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'bob', iceTransportPolicy: 'relay', ...threads ? {threads: 'threads'} : {}})
            const first: Room = await alice.join('relayed')
            const second: Room = await bob.join('relayed')
            //The ICE servers of the TURN server, with credentials for the member
            const turnServer = alice.iceServers.find((server): boolean => String(server.urls).startsWith('turn:'))
            assert.ok(turnServer?.username?.endsWith(':alice'), JSON.stringify(alice.iceServers))
            assert.strictEqual(await echoBetween(first, second), 'echo: hello')
            //Both members relay through the TURN server
            assert.strictEqual(server.turn!.allocations, 2)
            const sdp: string = second.peer('alice')!.connection.localDescription!.sdp!
            assert.ok(!/ typ (host|srflx) /.test(sdp) && / typ relay /.test(sdp), sdp)
            if (threads) assert.deepStrictEqual((await clients.get<PeerThreads>('threads')).load(), [1, 1])
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('checks the requests: members only, limits, authorization, the transports with clients', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer({
            signaling: {
                maxPeers: 2,
                maxMessageSize: 1000,
                authorize: (peer, room): boolean => room !== 'private' || peer.peerId === 'admin'
            }
        })
        const sockets: Socket[] = []
        try {
            const alice: Socket = await rawClient(server, 'alice')
            const bob: Socket = await rawClient(server, 'bob')
            const carol: Socket = await rawClient(server, 'carol')
            sockets.push(alice, bob, carol)
            const joined: any = await request(alice, SignalingMethod.join, {room: 'small', session: 's-alice'})
            assert.strictEqual(joined.success, true, JSON.stringify(joined))
            const result: SignalingJoinResult = joined.payload
            assert.deepStrictEqual({v: result.v, peerId: result.peerId, peers: result.peers, heartbeatInterval: result.heartbeatInterval}, {v: 1, peerId: 'alice', peers: [], heartbeatInterval: 0})
            //The other members get the newcomer, with its session
            const peerJoined: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => alice.once(SignalingEvent.peerJoined, resolve), 5000, 'peer-joined')
            assert.strictEqual((await request(bob, SignalingMethod.join, {room: 'small', metadata: 'b', session: 's-bob'})).payload.peers[0].session, 's-alice')
            assert.deepStrictEqual(await peerJoined, {room: 'small', peerId: 'bob', metadata: 'b', session: 's-bob'})
            //Full
            const full: any = await request(carol, SignalingMethod.join, {room: 'small'})
            assert.strictEqual(full.error?.errno, 'E_SIGNALING_LIMIT')
            //Not a member
            const stranger: any = await request(carol, SignalingMethod.signal, {room: 'small', to: 'alice', candidate: {candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host'}})
            assert.strictEqual(stranger.error?.errno, 'E_SIGNALING_NOT_A_MEMBER')
            //Too large
            const large: any = await request(bob, SignalingMethod.signal, {room: 'small', to: 'alice', description: {type: 'offer', sdp: 'x'.repeat(2000)}})
            assert.strictEqual(large.error?.errno, 'E_SIGNALING_LIMIT')
            //Not a valid description
            const invalid: any = await request(bob, SignalingMethod.signal, {room: 'small', to: 'alice', description: {type: 'other'}})
            assert.strictEqual(invalid.success, false)
            //Relayed, with the sender's session
            const signal: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => alice.once(SignalingEvent.signal, resolve), 5000, 'signal')
            assert.deepStrictEqual((await request(bob, SignalingMethod.signal, {room: 'small', to: 'alice', description: {type: 'offer', sdp: 'v=0'}})).payload, {delivered: true})
            assert.deepStrictEqual(await signal, {room: 'small', from: 'bob', session: 's-bob', description: {type: 'offer', sdp: 'v=0'}})
            //Refused by authorize
            const denied: any = await request(carol, SignalingMethod.join, {room: 'private'})
            assert.strictEqual(denied.error?.errno, 'E_SIGNALING_DENIED')
            //Disconnected: the others are told
            const peerLeft: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => alice.once(SignalingEvent.peerLeft, resolve), 5000, 'peer-left')
            bob.disconnect()
            assert.deepStrictEqual(await peerLeft, {room: 'small', peerId: 'bob', reason: 'disconnected'})
            //Left
            const leftEvents: unknown[] = []
            carol.on(SignalingEvent.peerLeft, (event: unknown): unknown => leftEvents.push(event))
            assert.strictEqual((await request(carol, SignalingMethod.join, {room: 'small'})).success, true)
            assert.strictEqual((await request(alice, SignalingMethod.leave, {room: 'small'})).success, true)
            await until((): boolean => leftEvents.length > 0, 5000, 'peer-left')
            assert.deepStrictEqual(leftEvents, [{room: 'small', peerId: 'alice', reason: 'left'}])
        } finally {
            for (const socket of sockets) socket.disconnect()
            await server.stop()
        }
    })

    it('keeps the peer-to-peer connections when the signaling reconnects', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const socket: Socket = connect(server.socketIO, {auth: {id: 'alice'}, transports: ['websocket'], reconnectionDelay: 100, reconnectionDelayMax: 200})
        const session: SignalingSession<PeerConnection> = new SignalingSession<PeerConnection>(new SocketIOTransport(socket), {
            //Its own session, as SignalingClient gives it (the default of the browsers needs the global crypto)
            session: 'session-of-alice',
            createPeerConnection: (configuration: PeerConnectionConfiguration): Promise<PeerConnection> => clients.get(PeerConnection, configuration)
        })
        try {
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
            const first: SharedRoom<PeerConnection> = await session.join('lobby')
            const second: Room = await bob.join('lobby')
            assert.strictEqual(await echoBetween(first, second), 'echo: hello')
            const peer: SharedPeer<PeerConnection> = first.peer('bob')!
            const kept: Peer = second.peer('alice')!
            //The transport of alice drops: bob's peer is kept while the connection is up, alice joins again
            const reconnected: Promise<void> = next<void>((resolve: () => void): unknown => session.on('connected', resolve), 10000, 'the reconnection')
            ;(socket.io as unknown as {engine: {close(): void}}).engine.close()
            await reconnected
            await until((): boolean => server.signaling.rooms().lobby?.length === 2, 5000, 'alice back in the room')
            assert.strictEqual(first.peer('bob'), peer)
            assert.strictEqual(second.peer('alice'), kept)
            assert.strictEqual(kept.away, false)
            assert.strictEqual(kept.connection.connectionState, 'connected')
            //The connection still carries the messages
            const echoed: Promise<string> = next<string>((resolve: (value: string) => void): void => {
                const channel: PeerChannel = kept.createDataChannel('after')
                channel.on('open', (): void => channel.send('again'))
                channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
            }, 20000, 'the echo after the reconnection')
            assert.strictEqual(await echoed, 'echo: again')
        } finally {
            await session.close()
            socket.disconnect()
            await clients.destroy()
            await server.stop()
        }
    })

    it('fails the requests sent when the signaling disconnects, and sends the ones made meanwhile once it connects again', {timeout: 30000}, async (): Promise<void> => {
        //Socket.IO: it keeps the emits made while disconnected, and sends them as it connects
        const socket: StandInSocketIO = new StandInSocketIO()
        const overSocketIO: SocketIOTransport = new SocketIOTransport(socket, 60000)
        const sent: Promise<unknown> = overSocketIO.request(SignalingMethod.leave, {room: 'first'})
        socket.connected = false
        socket.fire('disconnect')
        await assert.rejects(sent, {errno: 'E_SIGNALING_CLOSED'})
        const meanwhile: Promise<unknown> = overSocketIO.request(SignalingMethod.leave, {room: 'second'})
        socket.connected = true
        socket.fire('connect')
        socket.emitted[1].at(-1)({success: true, payload: {room: 'second'}})
        assert.deepStrictEqual(await meanwhile, {room: 'second'})
        //An answer coming after all is ignored
        socket.emitted[0].at(-1)({success: true, payload: {}})
        overSocketIO.close()
        //JSON-RPC over a WebSocket created again after a disconnection
        const sockets: StandInWebSocket[] = []
        const overWebSocket: JSONRPCTransport = new JSONRPCTransport((): StandInWebSocket => {
            sockets.push(new StandInWebSocket())
            return sockets.at(-1)!
        }, 60000)
        try {
            sockets[0].readyState = 1
            sockets[0].fire('open', {})
            const sentOverWebSocket: Promise<unknown> = overWebSocket.request(SignalingMethod.leave, {room: 'first'})
            assert.strictEqual(sockets[0].sent.length, 1)
            sockets[0].readyState = 3
            sockets[0].fire('close', {})
            await assert.rejects(sentOverWebSocket, {errno: 'E_SIGNALING_CLOSED'})
            const queued: Promise<unknown> = overWebSocket.request(SignalingMethod.leave, {room: 'second'})
            await until((): boolean => sockets.length === 2, 5000, 'the socket created again')
            sockets[1].readyState = 1
            sockets[1].fire('open', {})
            const request: {id: number, params: {room: string}} = JSON.parse(sockets[1].sent[0])
            assert.strictEqual(request.params.room, 'second')
            sockets[1].fire('message', {data: JSON.stringify({jsonrpc: '2.0', id: request.id, result: {room: 'second'}})})
            assert.deepStrictEqual(await queued, {room: 'second'})
        } finally {
            overWebSocket.close()
        }
    })

    it('takes out the members whose connection closes, and the ones without heartbeats', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer({signaling: {heartbeatInterval: 200}})
        const watcher: Socket = await rawClient(server, 'watcher')
        const member: WebSocket = new MemberWebSocket(`${server.jsonRPC}?id=member`)
        const left: {peerId: string, reason: string}[] = []
        watcher.on(SignalingEvent.peerLeft, (event: {peerId: string, reason: string}): unknown => left.push(event))
        try {
            assert.strictEqual((await request(watcher, SignalingMethod.join, {room: 'beats'})).success, true)
            //A member over JSON-RPC (WebSocket): the server sees its connection close, no heartbeat needed
            await next<void>((resolve: () => void): void => member.addEventListener('open', (): void => resolve()), 5000, 'the WebSocket')
            const answered: Promise<any> = next<any>((resolve: (value: any) => void): void => member.addEventListener('message', (event: MessageEvent): void => resolve(JSON.parse(String(event.data)))), 5000, 'the join')
            member.send(JSON.stringify({jsonrpc: '2.0', id: 1, method: SignalingMethod.join, params: {room: 'beats'}}))
            assert.strictEqual((await answered).result.heartbeatInterval, 0)
            //A member added by the application, through no connection: it has to send heartbeats
            assert.strictEqual((await server.signaling.join('ghost', 'beats')).heartbeatInterval, 200)
            await until((): boolean => left.some((event): boolean => event.peerId === 'ghost'), 5000, 'the member without heartbeats taken out')
            assert.deepStrictEqual(server.signaling.rooms().beats?.sort(), ['member', 'watcher'])
            member.close()
            await until((): boolean => left.some((event): boolean => event.peerId === 'member'), 5000, 'the closed member taken out')
            assert.deepStrictEqual(left, [{room: 'beats', peerId: 'ghost', reason: 'disconnected'}, {room: 'beats', peerId: 'member', reason: 'disconnected'}])
        } finally {
            member.close()
            watcher.disconnect()
            await server.stop()
        }
    })

    it('adds members of the application with a role: their events, no limits, their ids kept for them', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer({signaling: {maxPeers: 1, maxMessageSize: 1000, heartbeatInterval: 100}})
        const sockets: Socket[] = []
        try {
            //A member of the server, its events given to the application: not counted by maxPeers, no heartbeats
            const events: [string, any][] = []
            const added: SignalingJoinResult = await server.signaling.join('sfu:test', 'room', {role: 'sfu', receive: (event: string, payload: unknown): unknown => events.push([event, payload])})
            assert.strictEqual(added.heartbeatInterval, 0)
            const alice: Socket = await rawClient(server, 'alice')
            sockets.push(alice)
            const joined: SignalingJoinResult = (await request(alice, SignalingMethod.join, {room: 'room', session: 's-alice'})).payload
            assert.deepStrictEqual(joined.peers, [{peerId: 'sfu:test', role: 'sfu'}])
            assert.deepStrictEqual(events, [[SignalingEvent.peerJoined, {room: 'room', peerId: 'alice', metadata: undefined, session: 's-alice'}]])
            //Its signals are not limited in size nor rate, and may carry the streams of the media server
            const signals: any[] = []
            alice.on(SignalingEvent.signal, (event: unknown): unknown => signals.push(event))
            const streams: SignalingStream[] = [{id: 's1', peerId: 'bob', stream: 'camera'}]
            for (let index: number = 0; index < 120; index++) {
                assert.strictEqual(await server.signaling.signal('sfu:test', 'room', 'alice', {description: {type: 'offer', sdp: 'x'.repeat(2000)}, streams: streams}), true)
            }
            await until((): boolean => signals.length === 120, 5000, 'the signals')
            assert.deepStrictEqual(signals[0], {room: 'room', from: 'sfu:test', description: {type: 'offer', sdp: 'x'.repeat(2000)}, streams: streams})
            //The signals of a client reach it
            assert.deepStrictEqual((await request(alice, SignalingMethod.signal, {room: 'room', to: 'sfu:test', description: {type: 'answer', sdp: 'v=0'}})).payload, {delivered: true})
            assert.deepStrictEqual(events[1], [SignalingEvent.signal, {room: 'room', from: 'alice', session: 's-alice', description: {type: 'answer', sdp: 'v=0'}}])
            //It stays without heartbeats
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            assert.deepStrictEqual(server.signaling.rooms().room.sort(), ['alice', 'sfu:test'])
            //The ids of the members of the server are kept for them
            for (const id of ['sfu:test', 'whip:stream']) {
                const thief: Socket = await rawClient(server, id)
                sockets.push(thief)
                assert.strictEqual((await request(thief, SignalingMethod.join, {room: 'other'})).error?.errno, 'E_SIGNALING_DENIED')
            }
            await assert.rejects(server.signaling.join('sfu:other', 'other'), {errno: 'E_SIGNALING_DENIED'})
            //Full for the clients: maxPeers counts them only
            const bob: Socket = await rawClient(server, 'bob')
            sockets.push(bob)
            assert.strictEqual((await request(bob, SignalingMethod.join, {room: 'room'})).error?.errno, 'E_SIGNALING_LIMIT')
            //Its leaving is told to the clients
            const left: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => alice.once(SignalingEvent.peerLeft, resolve), 5000, 'peer-left')
            await server.signaling.leave('sfu:test', 'room')
            assert.deepStrictEqual(await left, {room: 'room', peerId: 'sfu:test', reason: 'left'})
        } finally {
            for (const socket of sockets) socket.disconnect()
            await server.stop()
        }
    })

    it('gives the members joining a room its media server, which joins it first', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const sockets: Socket[] = []
        try {
            const assigned: string[] = []
            mediaServers.set(server.signaling, async (room: string, peerId: string): Promise<string | undefined> => {
                assigned.push(`${room}/${peerId}`)
                if (room !== 'meeting') return undefined
                if (peerId === 'late') throw new SignalingLimitException('The media server is full')
                await server.signaling.join('sfu:node', room, {role: 'sfu', receive: (): void => undefined})
                return 'sfu:node'
            })
            const alice: Socket = await rawClient(server, 'alice')
            const late: Socket = await rawClient(server, 'late')
            sockets.push(alice, late)
            const meeting: SignalingJoinResult = (await request(alice, SignalingMethod.join, {room: 'meeting'})).payload
            assert.strictEqual(meeting.sfu, 'sfu:node')
            assert.deepStrictEqual(meeting.peers, [{peerId: 'sfu:node', role: 'sfu'}])
            const chat: SignalingJoinResult = (await request(alice, SignalingMethod.join, {room: 'chat'})).payload
            assert.strictEqual(chat.sfu, undefined)
            assert.strictEqual((await request(late, SignalingMethod.join, {room: 'meeting'})).error?.errno, 'E_SIGNALING_LIMIT')
            //Asked for the clients only, not for the member of the media server
            assert.deepStrictEqual(assigned, ['meeting/alice', 'chat/alice', 'meeting/late'])
        } finally {
            for (const socket of sockets) socket.disconnect()
            await server.stop()
        }
    })

    it('renews the TURN credentials before they expire', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer({turn: {secret: 'renewed', credentialTtl: 2}})
        const clients: Container = new Container()
        try {
            const client: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'renewing'})
            await client.join('turn')
            const username = (): string | undefined => client.iceServers.find((server): boolean => !!server.username)?.username
            const first: string | undefined = username()
            assert.ok(first?.endsWith(':renewing'))
            //Renewed at four fifths of their lifetime
            await until((): boolean => username() !== first, 5000, 'new credentials')
            assert.ok(Number(username()!.split(':')[0]) > Number(first!.split(':')[0]))
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    for (const threads of [false, true]) it(`restarts ICE on a connection, which goes on carrying the messages${threads ? ', the connections served in worker threads' : ''}`, {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        try {
            if (threads) await clients.setNamed('threads', PeerThreads, {threads: 2})
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice', ...threads ? {threads: 'threads'} : {}})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob', ...threads ? {threads: 'threads'} : {}})
            const first: Room = await alice.join('restart')
            first.on('peer', (peer: Peer): void => {
                peer.on('datachannel', (channel: PeerChannel): void => {
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
                })
            })
            const second: Room = await bob.join('restart')
            const channel: PeerChannel = await next<PeerChannel>((resolve: (channel: PeerChannel) => void): void => {
                second.on('peer', (peer: Peer): void => {
                    const opened: PeerChannel = peer.createDataChannel('chat')
                    opened.on('open', (): void => resolve(opened))
                })
            }, 20000, 'the channel')
            const ufrag = (peer: Peer): string | undefined => /a=ice-ufrag:(\S+)/.exec(peer.connection.localDescription?.sdp ?? '')?.[1]
            const peer: Peer = second.peer('alice')!
            const before: string | undefined = ufrag(peer)
            peer.restartIce()
            await until((): boolean => ufrag(peer) !== before && peer.connection.signalingState === 'stable' && peer.connection.connectionState === 'connected', 15000, 'the ICE restart')
            const echoed: Promise<string> = next<string>((resolve: (value: string) => void): unknown => channel.once('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString())), 10000, 'the echo')
            channel.send('after the restart')
            assert.strictEqual(await echoed, 'echo: after the restart')
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })
})
