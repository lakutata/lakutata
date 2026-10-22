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
     * Send a message.
     * @param data The message.
     */
    send(data: string): void
    /**
     * Add a listener of an event: `open`, `message`, `close`.
     * @param type The event.
     * @param listener The listener.
     */
    addEventListener(type: string, listener: (event: any) => void): void
    /**
     * Remove a listener.
     * @param type The event.
     * @param listener The listener.
     */
    removeEventListener(type: string, listener: (event: any) => void): void
    /**
     * Dispatch an event to the listeners.
     * @param event The event.
     */
    dispatchEvent(event: Event): boolean
    /**
     * Close it.
     */
    close(): void
}

/**
 * What the rooms need of a transceiver: `RTCRtpTransceiver` of the browsers, `RtpTransceiver` of Node.js.
 */
export interface TransceiverLike {
    /**
     * The media id of its line in the description; `null` until negotiated.
     */
    readonly mid: string | null
    /**
     * The direction wanted.
     */
    direction: string
    /**
     * The direction negotiated.
     */
    readonly currentDirection: string | null
    /**
     * Its sending side.
     */
    readonly sender: {
        readonly track: {readonly kind: string} | null
        replaceTrack(track: any): Promise<void>
        setStreams(...streams: any[]): void
    }
    /**
     * Its receiving side.
     */
    readonly receiver: {
        readonly track: {readonly kind: string}
    }
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
    /**
     * Whether it is the connection to the media server of a room: it negotiates the RTP header extensions the server
     * uses (the `headerExtensions` of `PeerConnection`; the browsers always do).
     */
    headerExtensions?: boolean
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
     * Add a track to send (the rooms use it for the types of the tracks and the streams).
     * @param track The track.
     * @param streams Its streams.
     */
    addTrack(track: any, ...streams: any[]): unknown

    /**
     * Add a transceiver sending a track.
     * @param track The track.
     * @param init Its direction and its streams.
     */
    addTransceiver(track: any, init: {direction: 'sendonly', streams: any[]}): TransceiverLike

    /**
     * The transceivers.
     */
    getTransceivers(): TransceiverLike[]

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
 * The track type of a peer connection type: `MediaStreamTrack` in the browsers, `MediaTrack` in Node.js
 */
export type TrackOf<Connection extends PeerConnectionLike<any>> = Parameters<Connection['addTrack']>[0]

/**
 * The stream type of a peer connection type: `MediaStream` in the browsers, a stream id in Node.js
 */
export type StreamOf<Connection extends PeerConnectionLike<any>> = Parameters<Connection['addTrack']> extends [any, ...infer Streams] ? Streams[number] : never

/**
 * The data channel type of a peer connection type
 */
export type ChannelOf<Connection extends PeerConnectionLike<any>> = ReturnType<Connection['createDataChannel']>

/**
 * The track event type of a peer connection type: `RTCTrackEvent` in the browsers, `PeerTrackEvent` in Node.js
 */
export type TrackEventOf<Connection> = Connection extends {ontrack: ((event: infer Event) => any) | null} ? Event : never
