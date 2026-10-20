import {describe, it} from 'node:test'
import assert from 'node:assert'
import {io as connect, type Socket} from 'socket.io-client'
import {Container} from '@lakutata/core'
import {SignalingEvent, SignalingMethod, type SignalingJoinResult} from '../protocol/SignalingProtocol.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import {SignalingSession} from '../shared/SignalingSession.js'
import {SocketIOTransport} from '../shared/Transports.js'
import type {Peer as SharedPeer} from '../shared/Peer.js'
import type {Room as SharedRoom} from '../shared/Room.js'
import type {PeerConnectionConfiguration} from '../shared/Connections.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

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

    it('connects a Socket.IO member and a JSON-RPC member, through the TURN relay only', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer({turn: {secret: 'test-secret'}})
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice', iceTransportPolicy: 'relay'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'bob', iceTransportPolicy: 'relay'})
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

    it('takes out the members whose connection closes, and the ones without heartbeats', {timeout: 30000}, async (): Promise<void> => {
        const server: TestServer = await startServer({signaling: {heartbeatInterval: 200}})
        const watcher: Socket = await rawClient(server, 'watcher')
        const member: WebSocket = new WebSocket(`${server.jsonRPC}?id=member`)
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

    it('restarts ICE on a connection, which goes on carrying the messages', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
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
