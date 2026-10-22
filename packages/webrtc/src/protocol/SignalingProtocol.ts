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
 * The role the server gives a member it adds itself: `sfu` for the media server of a room (the other members connect
 * to it only, and receive the media of each other through it), `whip` for a stream published with WHIP.
 */
export type SignalingRole = 'sfu' | 'whip'

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
    /**
     * The role of a member the server added itself; none for the clients.
     */
    role?: SignalingRole
    /**
     * The id of the media server the member is connected to (a member of role `sfu`), in a room with one; set by the
     * server. With a cluster, the members of a room may be connected to the media servers of different nodes.
     */
    sfu?: string
}

/**
 * A stream the media server of a room sends a member: its id on the connection to the server (the stream id of the
 * MSID, at most 64 characters), the member it comes from, and its id on the connection of that member.
 */
export interface SignalingStream {
    /**
     * The id of the stream on the connection to the media server.
     */
    id: string
    /**
     * The id of the member sending it.
     */
    peerId: string
    /**
     * The id of the stream on the connection of that member.
     */
    stream: string
}

/**
 * The data channel of a member's connection to the media server of its room on which the member controls what it
 * receives: both sides create it, negotiated, with this label and this id; its messages are
 * {@link SignalingControlMessage}s in JSON.
 */
export const SignalingControlChannel = {
    label: 'webrtc.control',
    id: 1023
} as const

/**
 * A message of a member to the media server of its room, on {@link SignalingControlChannel}: `pause` stops sending the
 * member the track of a transceiver (by its `mid` on the connection to the server), `resume` sends it again.
 */
export interface SignalingControlMessage {
    /**
     * `pause` or `resume`.
     */
    type: 'pause' | 'resume'
    /**
     * The media id of the transceiver receiving the track.
     */
    mid: string
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
    /**
     * The id of the media server of the room (a member of role `sfu`), when the room has one: the client connects to it
     * only, not to the other members.
     */
    sfu?: string
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
    /**
     * With a description of the media server of the room: the streams it sends, and whose they are.
     */
    streams?: SignalingStream[]
}
