import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'

/**
 * What the rooms need of a data channel: `RTCDataChannel` of the browsers, `PeerChannel` of Node.js.
 */
export interface DataChannelLike {
    /**
     * Its label.
     */
    readonly label: string
    /**
     * `connecting`, `open`, `closing` or `closed`.
     */
    readonly readyState: string
    /**
     * Close it.
     */
    close(): void
}

/**
 * The options of a data channel, as `RTCDataChannelInit`.
 */
export interface DataChannelOptions {
    /**
     * Whether the messages arrive in order.
     * @default true
     */
    ordered?: boolean
    /**
     * How many times a message is sent again at most; none for a reliable channel.
     */
    maxRetransmits?: number
    /**
     * How long a message is sent again at most, in milliseconds; none for a reliable channel.
     */
    maxPacketLifeTime?: number
    /**
     * The subprotocol.
     * @default ''
     */
    protocol?: string
    /**
     * Whether both peers create the channel themselves with the same `id`, instead of one of them announcing it.
     * @default false
     */
    negotiated?: boolean
    /**
     * The id of a negotiated channel.
     */
    id?: number
}

/**
 * The configuration of a peer connection that the rooms set: the ICE servers, and whether to use only the TURN relays.
 */
export interface PeerConnectionConfiguration {
    /**
     * The ICE servers.
     */
    iceServers?: SignalingIceServer[]
    /**
     * `all`, or `relay` to use only the TURN relays.
     */
    iceTransportPolicy?: 'all' | 'relay'
}

/**
 * What the rooms need of a peer connection: `RTCPeerConnection` of the browsers, `PeerConnection` of Node.js.
 */
export interface PeerConnectionLike<Channel extends DataChannelLike = DataChannelLike> {
    /**
     * The state of the offer and answer exchange.
     */
    readonly signalingState: string
    /**
     * The state of the connection.
     */
    readonly connectionState: string
    /**
     * The local description.
     */
    readonly localDescription: SignalingDescription | null

    /**
     * Add a listener of an event: `negotiationneeded`, `icecandidate`, `connectionstatechange`, `datachannel`, `track`.
     * @param type The event.
     * @param listener The listener.
     */
    addEventListener(type: string, listener: (event: any) => void): void

    /**
     * Set the local description: the offer or the answer it creates, or a rollback.
     * @param description A rollback; none for the offer or the answer.
     */
    setLocalDescription(description?: {type: 'rollback'}): Promise<unknown>

    /**
     * Set the remote description.
     * @param description The description.
     */
    setRemoteDescription(description: SignalingDescription): Promise<unknown>

    /**
     * Add a remote candidate.
     * @param candidate The candidate.
     */
    addIceCandidate(candidate: SignalingCandidate): Promise<unknown>

    /**
     * Create a data channel.
     * @param label Its label.
     * @param options Its options.
     */
    createDataChannel(label: string, options?: DataChannelOptions): Channel

    /**
     * Restart ICE: the next offer gathers new candidates.
     */
    restartIce(): void

    /**
     * The configuration.
     */
    getConfiguration(): object

    /**
     * Change the configuration (the ICE servers).
     * @param configuration The whole configuration.
     */
    setConfiguration(configuration: object): void

    /**
     * Close the connection.
     */
    close(): unknown
}

/**
 * Creates the peer connections of the rooms.
 * @param configuration The ICE servers given by the signaling, and the transport policy.
 * @returns The connection.
 */
export type PeerConnectionFactory<Connection extends PeerConnectionLike<any>> = (configuration: PeerConnectionConfiguration) => Connection | Promise<Connection>

/**
 * The data channel type of a peer connection type
 */
export type ChannelOf<Connection extends PeerConnectionLike<any>> = ReturnType<Connection['createDataChannel']>

/**
 * The track event type of a peer connection type: `RTCTrackEvent` in the browsers, `PeerTrackEvent` in Node.js
 */
export type TrackEventOf<Connection> = Connection extends {ontrack: ((event: infer Event) => any) | null} ? Event : never
