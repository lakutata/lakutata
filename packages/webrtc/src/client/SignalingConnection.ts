/// <reference lib="dom" preserve="true" />
import type {PeerConnectionConfiguration} from '../shared/Connections.js'
import type {Peer as SharedPeer} from '../shared/Peer.js'
import type {Room as SharedRoom} from '../shared/Room.js'
import {SignalingSession} from '../shared/SignalingSession.js'
import {JSONRPCTransport, type SignalingTransport, SocketIOTransport, type SocketIOSocketLike, type WebSocketLike} from '../shared/Transports.js'

/**
 * A room joined by a {@link SignalingConnection}: its peers are `RTCPeerConnection`s.
 */
export type Room = SharedRoom<RTCPeerConnection>

/**
 * Another member of a room joined by a {@link SignalingConnection}, and the `RTCPeerConnection` to it.
 */
export type Peer = SharedPeer<RTCPeerConnection>

/**
 * The options of a {@link SignalingConnection}.
 */
export interface SignalingConnectionOptions {
    /**
     * `relay` to use only the TURN relays.
     * @default 'all'
     */
    iceTransportPolicy?: 'all' | 'relay'
    /**
     * More options of the peer connections (`bundlePolicy`, `certificates`…); the ICE servers come from the server.
     * @default none
     */
    configuration?: RTCConfiguration
    /**
     * Creates the peer connections, instead of `new RTCPeerConnection()` (for an implementation of another
     * environment).
     * @default none
     */
    createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection
    /**
     * How long a request waits for its answer, in milliseconds.
     * @default 15000
     */
    timeout?: number
}

/**
 * The transport of a socket
 * @param socket
 * @param timeout
 */
function transportOf(socket: SocketIOSocketLike | WebSocketLike | (() => WebSocketLike), timeout: number | undefined): SignalingTransport {
    if (typeof socket === 'function') return new JSONRPCTransport(socket, timeout)
    if ('send' in socket && 'readyState' in socket) return new JSONRPCTransport(socket as WebSocketLike, timeout)
    return new SocketIOTransport(socket as SocketIOSocketLike, timeout)
}

/**
 * The signaling of a browser (or of the renderer of Electron) for the signaling servers of `@lakutata/webrtc`: it joins
 * rooms and connects to their other members with the `RTCPeerConnection` of the browser. Give it the connection of the
 * application: a Socket.IO socket (`io()` of socket.io-client, its `auth.id` being the member's id), a `WebSocket`
 * speaking JSON-RPC (its `id` query parameter being the member's id), or a function creating the `WebSocket`, to
 * reconnect. After a reconnection the rooms are joined again, the peer-to-peer connections kept.
 *
 * In a room, the offers and the answers are exchanged as the W3C "perfect negotiation" does it: any member may add
 * channels and tracks at any time. The ICE servers (with TURN credentials, renewed before they expire) come from the
 * server.
 * @example
 * ```typescript
 * import {io} from 'socket.io-client'
 * import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'
 *
 * const signaling: SignalingConnection = new SignalingConnection(io('https://example.com', {auth: {id: 'alice'}}))
 * const room: Room = await signaling.join('room-1')
 * room.on('peer', (peer: Peer): void => {
 *     //Unordered and unreliable: a lost position is not sent again
 *     const channel: RTCDataChannel = peer.createDataChannel('position', {ordered: false, maxRetransmits: 0})
 *     channel.addEventListener('open', (): void => channel.send(JSON.stringify({x: 1, y: 2})))
 *     peer.on('datachannel', (remote: RTCDataChannel): void => {
 *         remote.addEventListener('message', (event: MessageEvent): void => console.log(peer.id, event.data))
 *     })
 * })
 * ```
 */
export class SignalingConnection extends SignalingSession<RTCPeerConnection> {

    /**
     * Use a connection to the signaling.
     * @param socket A Socket.IO socket, a `WebSocket` speaking JSON-RPC, or a function creating one (to reconnect).
     * @param options The options of the peer connections, the timeout of the requests.
     * @example
     * ```typescript
     * import {SignalingConnection} from '@lakutata/webrtc/client'
     *
     * //JSON-RPC over WebSocket, reconnecting: the member's id is the id query parameter
     * const signaling: SignalingConnection = new SignalingConnection((): WebSocket => new WebSocket('wss://example.com/rpc?id=alice'))
     * ```
     */
    constructor(socket: SocketIOSocketLike | WebSocketLike | (() => WebSocketLike), options: SignalingConnectionOptions = {}) {
        const create: (configuration: RTCConfiguration) => RTCPeerConnection = options.createPeerConnection ?? ((configuration: RTCConfiguration): RTCPeerConnection => new RTCPeerConnection(configuration))
        super(transportOf(socket, options.timeout), {
            iceTransportPolicy: options.iceTransportPolicy,
            //The browsers negotiate the header extensions of a media server by themselves
            createPeerConnection: ({headerExtensions: _headerExtensions, ...configuration}: PeerConnectionConfiguration): RTCPeerConnection => create({...options.configuration, ...configuration})
        })
    }
}
