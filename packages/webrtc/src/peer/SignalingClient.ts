import {randomBytes, randomUUID} from 'node:crypto'
import {DTO, Provider} from '@lakutata/core'
import {Autoload, Configurable, Transient} from '@lakutata/core/decorator/di'
import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {PeerConnectionConfiguration} from '../shared/Connections.js'
import type {EmitterListener} from '../shared/Emitter.js'
import type {Peer as SharedPeer} from '../shared/Peer.js'
import type {Room as SharedRoom} from '../shared/Room.js'
import {type JoinOptions, SignalingSession, type SignalingSessionEvents} from '../shared/SignalingSession.js'
import {JSONRPCTransport, type SignalingTransport, SocketIOTransport, type SocketIOSocketLike, type WebSocketLike} from '../shared/Transports.js'
import {SignalingConnectionException} from '../exceptions/SignalingConnectionException.js'
import {PeerConnection} from './PeerConnection.js'

/**
 * A room joined by a {@link SignalingClient}: its peers are {@link PeerConnection}s.
 */
export type Room = SharedRoom<PeerConnection>

/**
 * Another member of a room joined by a {@link SignalingClient}, and the {@link PeerConnection} to it.
 */
export type Peer = SharedPeer<PeerConnection>

/**
 * The options of a {@link SignalingClient}.
 */
export interface SignalingClientOptions {
    /**
     * The URL of the signaling: `http:` or `https:` for Socket.IO (with the package `socket.io-client`), `ws:` or `wss:`
     * for JSON-RPC over WebSocket.
     */
    url: string
    /**
     * The client id, the member's id in the rooms.
     * @default a random UUID
     */
    id?: string
    /**
     * The path of Socket.IO.
     * @default '/socket.io'
     */
    path?: string
    /**
     * More fields of the Socket.IO handshake's `auth` (a token), besides `id`.
     * @default none
     */
    auth?: Record<string, unknown>
    /**
     * How long a request waits for its answer, in milliseconds.
     * @default 15000
     */
    timeout?: number
    /**
     * `relay` to use only the TURN relays.
     * @default 'all'
     */
    iceTransportPolicy?: 'all' | 'relay'
    /**
     * The UDP ports of the local candidates, as `[first, last]`.
     * @default any free port
     */
    icePortRange?: [number, number]
    /**
     * More addresses given as local candidates (the public address of a NAT forwarding `icePortRange` with the same
     * port numbers).
     * @default none
     */
    iceAdditionalHostAddresses?: string[]
    /**
     * The audio and video codecs of the connections, as MIME types in the order of preference (see `PeerConnection`).
     * @default ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/H264', 'video/VP9']
     */
    codecs?: string[]
    /**
     * The name of a `PeerThreads` component: the connections to the other members run their engine in its worker
     * threads (see the `threads` option of `PeerConnection`).
     * @default none: the engines run in the main thread
     */
    threads?: string
}

/**
 * The WebSocket of JSON-RPC: the global one (the browsers, Node.js 22 and later, Bun, Electron), else the one of the
 * package ws (Node.js 18 to 21, which have none)
 */
async function webSocketClass(): Promise<new (url: string) => WebSocketLike> {
    const global: (new (url: string) => WebSocketLike) | undefined = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
    if (global) return global
    try {
        const module: string = 'ws'
        const loaded: { WebSocket?: new (url: string) => WebSocketLike, default?: new (url: string) => WebSocketLike } = await import(module)
        return (loaded.WebSocket ?? loaded.default)!
    } catch {
        throw new SignalingConnectionException('JSON-RPC over WebSocket needs the global WebSocket (Node.js 22 and later) or the package ws: npm install ws')
    }
}

/**
 * A lakutata application as a member of the rooms of a signaling server of this package (`Signaling` and
 * `SignalingController`, on this application or another one): it joins rooms and connects to their other members,
 * browsers or applications, with {@link PeerConnection}s. Over Socket.IO (an `http:` or `https:` URL, with the package
 * `socket.io-client`) or JSON-RPC over WebSocket (a `ws:` or `wss:` URL, with the global `WebSocket` of Node.js 22 and
 * later and of Bun, else the package `ws`);
 * it reconnects by itself and joins its rooms again, keeping the peer-to-peer connections.
 *
 * Get a new one with `getObject(SignalingClient, options)` (it is `@Transient`, and needs no registration); `close()`
 * leaves the rooms and closes the connections.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {type Peer, type PeerChannel, type Room, SignalingClient} from '@lakutata/webrtc'
 *
 * //A service of a device: sends its telemetry to whoever joins its room
 * class TelemetryService extends Component {
 *     protected async init(): Promise<void> {
 *         const signaling: SignalingClient = await this.getObject(SignalingClient, {url: 'https://example.com', id: 'device-7'})
 *         const room: Room = await signaling.join('device-7')
 *         room.on('peer', (peer: Peer): void => {
 *             const channel: PeerChannel = peer.createDataChannel('telemetry')
 *             const timer: NodeJS.Timeout = setInterval((): void => {
 *                 if (channel.readyState === 'open') channel.send(JSON.stringify({temperature: 21.5}))
 *             }, 1000)
 *             peer.on('close', (): void => clearInterval(timer))
 *         })
 *     }
 * }
 * ```
 */
@Autoload()
@Transient()
export class SignalingClient extends Provider {

    /**
     * The URL of the signaling.
     */
    @Configurable(DTO.String().uri({scheme: ['http', 'https', 'ws', 'wss']}).required())
    protected readonly url: string

    /**
     * The client id.
     */
    @Configurable(DTO.String().min(1).max(200).optional())
    protected readonly id?: string

    /**
     * The path of Socket.IO.
     */
    @Configurable(DTO.String().optional().default('/socket.io'))
    protected readonly path: string

    /**
     * More fields of the Socket.IO handshake's auth.
     */
    @Configurable(DTO.Object().optional().default({}))
    protected readonly auth: Record<string, unknown>

    /**
     * How long a request waits for its answer.
     */
    @Configurable(DTO.Number().integer().positive().optional().default(15000))
    protected readonly timeout: number

    /**
     * `all`, or `relay` to use only the TURN relays.
     */
    @Configurable(DTO.String().valid('all', 'relay').optional().default('all'))
    protected readonly iceTransportPolicy: 'all' | 'relay'

    /**
     * The UDP ports of the local candidates.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly icePortRange?: [number, number]

    /**
     * More addresses given as local candidates.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly iceAdditionalHostAddresses?: string[]

    /**
     * The audio and video codecs of the connections.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly codecs?: string[]

    /**
     * The name of the component of the worker threads of the connections.
     */
    @Configurable(DTO.String().optional())
    protected readonly threads?: string

    #clientId: string

    #socket?: {disconnect(): unknown}

    #session: SignalingSession<PeerConnection>

    #closed: boolean = false

    /**
     * Connect to the signaling (the requests wait for the connection).
     * @protected
     */
    protected async init(): Promise<void> {
        this.#clientId = this.id ?? randomUUID()
        const transport: SignalingTransport = await this.transport()
        this.#session = new SignalingSession<PeerConnection>(transport, {
            //The random session of node:crypto: the global crypto of the session's default comes in Node.js 19
            session: randomBytes(12).toString('hex'),
            iceTransportPolicy: this.iceTransportPolicy,
            createPeerConnection: (configuration: PeerConnectionConfiguration): Promise<PeerConnection> => this.getObject(PeerConnection, {
                ...configuration,
                icePortRange: this.icePortRange,
                iceAdditionalHostAddresses: this.iceAdditionalHostAddresses,
                ...this.codecs ? {codecs: this.codecs} : {},
                ...this.threads ? {threads: this.threads} : {}
            })
        })
    }

    /**
     * Leave the rooms and disconnect.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#closed = true
        await this.#session?.close()
        this.#socket?.disconnect()
    }

    /**
     * The client id: the member's id in the rooms.
     */
    public get clientId(): string {
        return this.#clientId
    }

    /**
     * Whether the signaling is connected.
     */
    public get connected(): boolean {
        return this.#session.connected
    }

    /**
     * The rooms joined.
     */
    public get rooms(): Room[] {
        return this.#session.rooms
    }

    /**
     * The ICE servers given by the server, with the TURN credentials (renewed before they expire).
     */
    public get iceServers(): SignalingIceServer[] {
        return this.#session.iceServers
    }

    /**
     * Join a room: its `peer` event gives the other members, each with its {@link PeerConnection}.
     * @param room The room.
     * @param options The metadata the other members get.
     * @returns The room.
     * @throws {SignalingRequestError} When the server refuses (`E_SIGNALING_DENIED`, `E_SIGNALING_LIMIT`) or does not
     * answer (`E_SIGNALING_TIMEOUT`).
     * @example
     * ```typescript
     * import type {Room, SignalingClient} from '@lakutata/webrtc'
     *
     * declare const signaling: SignalingClient
     * const room: Room = await signaling.join('meeting', {metadata: {name: 'Recorder'}})
     * ```
     */
    public async join(room: string, options: JoinOptions = {}): Promise<Room> {
        return await this.#session.join(room, options)
    }

    /**
     * Listen to the signaling: `connected` (again, after a disconnection; the rooms are joined again), `disconnected`
     * (the peer-to-peer connections stay up), `error` (a background task failed).
     * @param event The event.
     * @param listener The listener.
     * @returns The client.
     * @example
     * ```typescript
     * import type {SignalingClient} from '@lakutata/webrtc'
     *
     * declare const signaling: SignalingClient
     * signaling.on('disconnected', (): void => console.log('signaling lost, reconnecting'))
     * ```
     */
    public on<Event extends keyof SignalingSessionEvents>(event: Event, listener: EmitterListener<SignalingSessionEvents[Event]>): this {
        this.#session.on(event, listener)
        return this
    }

    /**
     * Remove a listener added with `on`.
     * @param event The event.
     * @param listener The listener.
     * @returns The client.
     * @example
     * ```typescript
     * import type {SignalingClient} from '@lakutata/webrtc'
     *
     * declare const signaling: SignalingClient
     * const listener = (error: Error): void => console.error(error)
     * signaling.on('error', listener)
     * signaling.off('error', listener)
     * ```
     */
    public off<Event extends keyof SignalingSessionEvents>(event: Event, listener: EmitterListener<SignalingSessionEvents[Event]>): this {
        this.#session.off(event, listener)
        return this
    }

    /**
     * Leave the rooms, close their connections, disconnect, and destroy the object.
     * @returns Resolves once done.
     * @example
     * ```typescript
     * import type {SignalingClient} from '@lakutata/webrtc'
     *
     * declare const signaling: SignalingClient
     * await signaling.close()
     * ```
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        await this.dispose()
    }

    /**
     * The transport of the URL: Socket.IO or JSON-RPC over WebSocket
     * @protected
     */
    protected async transport(): Promise<SignalingTransport> {
        const url: URL = new URL(this.url)
        if (url.protocol === 'ws:' || url.protocol === 'wss:') {
            const WebSocketClass: new (url: string) => WebSocketLike = await webSocketClass()
            url.searchParams.set('id', this.#clientId)
            const address: string = url.toString()
            return new JSONRPCTransport((): any => new WebSocketClass(address), this.timeout)
        }
        let io: (url: string, options: Record<string, unknown>) => SocketIOSocketLike & {disconnect(): unknown}
        try {
            const module: string = 'socket.io-client'
            io = (await import(module)).io
        } catch {
            throw new SignalingConnectionException('Socket.IO needs the package socket.io-client: npm install socket.io-client')
        }
        const socket: SocketIOSocketLike & {disconnect(): unknown} = io(this.url, {
            path: this.path,
            auth: {...this.auth, id: this.#clientId},
            transports: ['websocket']
        })
        this.#socket = socket
        return new SocketIOTransport(socket, this.timeout)
    }
}
