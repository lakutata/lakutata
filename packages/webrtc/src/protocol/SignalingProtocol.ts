/**
 * The version of the signaling protocol, returned by `webrtc.join`; a later version stays compatible with the clients
 * of this one.
 */
export const SIGNALING_PROTOCOL_VERSION: number = 1

/**
 * The methods of the signaling requests: a request is a service call whose pattern is `{method}` (the JSON-RPC method of
 * a JSON-RPC request, the `method` field of a Socket.IO message).
 */
export const SignalingMethod = {
    /**
     * Join a room: `{room, metadata?, session?}`, answered with a {@link SignalingJoinResult}. The session is a random
     * string the client chooses once per connection object: joining again with the same one (after a reconnection of the
     * signaling) keeps the connections of the other members, a new one (a reloaded page) replaces them.
     */
    join: 'webrtc.join',
    /**
     * Send a description or a candidate to a member of a room: `{room, to, description?, candidate?}`, answered with
     * `{delivered}`.
     */
    signal: 'webrtc.signal',
    /**
     * Leave a room: `{room}`, answered with `{}`.
     */
    leave: 'webrtc.leave',
    /**
     * Get the ICE servers again, with new TURN credentials: `{}`, answered with `{iceServers}`.
     */
    iceServers: 'webrtc.iceServers',
    /**
     * Tell the server the client is still there: `{}`, answered with `{}`. A client sends it every `heartbeatInterval`
     * milliseconds of the join result when it is not 0 (the server cannot see the client's disconnection).
     */
    heartbeat: 'webrtc.heartbeat'
} as const

/**
 * The events pushed by the server to the members of a room (`Entrypoint.notify`): a Socket.IO event, a JSON-RPC
 * notification.
 */
export const SignalingEvent = {
    /**
     * A member joined a room the client is in: a {@link SignalingPeerEvent}.
     */
    peerJoined: 'webrtc:peer-joined',
    /**
     * A member left a room the client is in, or was disconnected: a {@link SignalingPeerLeftEvent}.
     */
    peerLeft: 'webrtc:peer-left',
    /**
     * A description or a candidate from a member: a {@link SignalingSignalEvent}.
     */
    signal: 'webrtc:signal'
} as const

/**
 * A session description, as `RTCSessionDescriptionInit`.
 */
export interface SignalingDescription {
    /**
     * `offer`, `answer`, `pranswer` or `rollback`.
     */
    type: 'offer' | 'answer' | 'pranswer' | 'rollback'
    /**
     * The SDP; none for a rollback.
     */
    sdp?: string
}

/**
 * An ICE candidate, as `RTCIceCandidateInit`; an empty `candidate` is the end of the candidates.
 */
export interface SignalingCandidate {
    /**
     * The `candidate:` attribute of the SDP.
     */
    candidate: string
    /**
     * The media stream of the candidate.
     */
    sdpMid?: string | null
    /**
     * The index of its media description.
     */
    sdpMLineIndex?: number | null
    /**
     * The ICE username fragment it belongs to.
     */
    usernameFragment?: string | null
}

/**
 * An ICE server, as `RTCIceServer`.
 */
export interface SignalingIceServer {
    /**
     * The URLs: `stun:host:port`, `turn:host:port?transport=udp|tcp`, `turns:host:port`.
     */
    urls: string | string[]
    /**
     * The TURN username.
     */
    username?: string
    /**
     * The TURN password.
     */
    credential?: string
}

/**
 * A member of a room, as the other members see it.
 */
export interface SignalingPeer {
    /**
     * The member's id: the client id of its connection to the signaling.
     */
    peerId: string
    /**
     * What the member gave when it joined (a name, a role).
     */
    metadata?: unknown
    /**
     * The session the member gave when it joined: a new one means a new client behind the same id.
     */
    session?: string
}

/**
 * The answer to `webrtc.join`.
 */
export interface SignalingJoinResult {
    /**
     * The version of the protocol ({@link SIGNALING_PROTOCOL_VERSION}).
     */
    v: number
    /**
     * The id of the member who joined.
     */
    peerId: string
    /**
     * The members already in the room.
     */
    peers: SignalingPeer[]
    /**
     * The ICE servers for the connections of the room, with TURN credentials valid for `credentialTtl` seconds.
     */
    iceServers: SignalingIceServer[]
    /**
     * How long the TURN credentials are valid, in seconds; 0 when there are none.
     */
    credentialTtl: number
    /**
     * How often to send `webrtc.heartbeat`, in milliseconds; 0 when the server detects the disconnections itself.
     */
    heartbeatInterval: number
}

/**
 * The event {@link SignalingEvent.peerJoined}.
 */
export interface SignalingPeerEvent extends SignalingPeer {
    /**
     * The room.
     */
    room: string
}

/**
 * The event {@link SignalingEvent.peerLeft}.
 */
export interface SignalingPeerLeftEvent {
    /**
     * The room.
     */
    room: string
    /**
     * The id of the member.
     */
    peerId: string
    /**
     * `left` when it asked to leave, `disconnected` when its client went away: its peer-to-peer connections may still be
     * up, and it joins again with the same session once its client reconnects.
     */
    reason: 'left' | 'disconnected'
}

/**
 * The event {@link SignalingEvent.signal}: a description or a candidate from another member.
 */
export interface SignalingSignalEvent {
    /**
     * The room.
     */
    room: string
    /**
     * The id of the member who sent it.
     */
    from: string
    /**
     * The session of the member who sent it.
     */
    session?: string
    /**
     * A description, or none for a candidate.
     */
    description?: SignalingDescription
    /**
     * A candidate, or none for a description.
     */
    candidate?: SignalingCandidate | null
}
