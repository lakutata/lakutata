import type {Extensions} from '../lib/rtp/index.js'
import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import type {EngineOptions} from './EngineConfig.js'
import type {RtpTransceiverDirection} from './RtpTransceiver.js'

/**
 * What a worker thread of connections is started with
 */
export interface PeerWorkerData {
    readonly thread: number
}

/**
 * A codec, as plain data
 */
export interface PeerCodec {
    readonly payloadType?: number
    readonly mimeType: string
    readonly clockRate: number
    readonly channels?: number
    readonly parameters?: string
    readonly rtcpFeedback?: {type: string, parameter?: string}[]
}

/**
 * A track received by a connection of a worker thread (its reference in the thread)
 */
export interface PeerTrackInfo {
    readonly ref: string
    readonly kind: 'audio' | 'video'
    readonly id: string
    readonly codec?: PeerCodec
}

/**
 * A transceiver of a connection of a worker thread (`m…` when added by the main thread, `w…` by the thread)
 */
export interface PeerTransceiverInfo {
    readonly ref: string
    readonly kind: 'audio' | 'video'
    readonly mid: string | null
    readonly direction: RtpTransceiverDirection
    readonly currentDirection: RtpTransceiverDirection | 'stopped' | null
    //Whether addTrack may give it a track, rather than adding a transceiver
    readonly reusable: boolean
    //The track it sends: the reference of a track of the main thread, and its codec once negotiated
    readonly sending: string | null
    readonly sendingCodec?: PeerCodec
    //The track it receives
    readonly receiving: PeerTrackInfo
}

/**
 * The state of a connection in a worker thread, sent with its events and the replies to its requests: the main thread
 * reads its copy of it
 */
export interface PeerConnectionState {
    readonly connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'
    readonly iceConnectionState: string
    readonly iceGatheringState: string
    readonly signalingState: string
    readonly localDescription: SignalingDescription | null
    readonly remoteDescription: SignalingDescription | null
    //The largest message the other peer accepts, once the SCTP transport is negotiated
    readonly maxMessageSize: number | null
    readonly configuration: {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'}
    readonly transceivers: PeerTransceiverInfo[]
    //The last of the changes of the transceivers by the main thread done (they are numbered)
    readonly ops: number
    //When the state was read: a reply may be sent after a later state, the main thread keeps the latest
    readonly seq: number
}

/**
 * What the main thread knows of a data channel of a worker thread
 */
export interface PeerChannelInfo {
    readonly label: string
    readonly protocol: string
    readonly ordered: boolean
    readonly maxRetransmits: number | null
    readonly maxPacketLifeTime: number | null
    readonly negotiated: boolean
    readonly id: number | null
    readonly readyState: 'connecting' | 'open' | 'closing' | 'closed'
}

/**
 * A method of a connection the main thread calls, and waits for
 */
export type PeerCall =
    {method: 'createOffer', args: [options: {iceRestart?: boolean}]}
    | {method: 'createAnswer', args: []}
    | {method: 'setLocalDescription', args: [description?: SignalingDescription]}
    | {method: 'setRemoteDescription', args: [description: SignalingDescription]}
    | {method: 'addIceCandidate', args: [candidate: SignalingCandidate]}

/**
 * A change of the transceivers by the main thread, numbered (`op`)
 */
export type PeerTransceiverChange =
    //created: the reference of a transceiver added (unless the one chosen takes the track)
    {type: 'addTrack', conn: number, op: number, track: string, streams: string[], transceiver: string | null, created: string}
    | {type: 'addTransceiver', conn: number, op: number, created: string, kind: 'audio' | 'video', track?: string, direction: RtpTransceiverDirection, streams: string[]}
    | {type: 'removeTrack', conn: number, op: number, transceiver: string}
    | {type: 'direction', conn: number, op: number, transceiver: string, direction: RtpTransceiverDirection}
    | {type: 'stopTransceiver', conn: number, op: number, transceiver: string}
    | {type: 'replaceTrack', conn: number, op: number, transceiver: string, track: string | null}
    | {type: 'setStreams', conn: number, op: number, transceiver: string, streams: string[]}

/**
 * The messages of the main thread to a worker thread of connections (`conn` is the connection, `ch` a channel, `track`
 * a track of the main thread sent, or a track received in the thread)
 */
export type PeerToWorker =
    {type: 'open', conn: number, options: EngineOptions}
    | {type: 'call', conn: number} & PeerCall
    | {type: 'close', conn: number}
    | {type: 'restartIce', conn: number}
    | {type: 'setConfiguration', conn: number, configuration: {iceServers?: SignalingIceServer[], iceTransportPolicy?: 'all' | 'relay'}}
    | {type: 'channel', conn: number, ch: string, label: string, options: DataChannelOptions}
    //Messages of a channel, in their order
    | {type: 'send', conn: number, ch: string, data: (string | Uint8Array)[]}
    | {type: 'closeChannel', conn: number, ch: string}
    //A track of the main thread sent by the connection: its copy in the thread, its packets, its end
    | {type: 'mirror', conn: number, track: string, kind: 'audio' | 'video', id: string, remote: boolean, codec?: PeerCodec}
    | {type: 'rtp', conn: number, track: string, packets: Uint8Array[], extensions: (Extensions | null)[]}
    | {type: 'source', conn: number, track: string, header: {sequenceNumber: number, timestamp: number}}
    | {type: 'mirrorEnded', conn: number, track: string}
    | {type: 'dropTrack', conn: number, track: string}
    | PeerTransceiverChange
    //A track received: a key frame asked for, whether its packets are wanted in the main thread
    //What the main thread read: the bytes of the messages received (given back to the receive window), and of the
    //RTP packets
    | {type: 'consumed', conn: number, bytes: number, rtp: number}
    | {type: 'keyframe', conn: number, track: string}
    | {type: 'want', conn: number, track: string, wanted: boolean}
    | {type: 'debug', enabled: boolean}
    | {type: 'stop'}

/**
 * The messages of a worker thread of connections to the main thread
 */
export type PeerFromWorker =
    {type: 'ready'}
    | {type: 'event', conn: number, name: 'icecandidate', candidate: SignalingCandidate | null, state: PeerConnectionState}
    | {type: 'event', conn: number, name: 'negotiationneeded', state: PeerConnectionState}
    | {type: 'event', conn: number, name: 'connectionstatechange' | 'iceconnectionstatechange' | 'icegatheringstatechange' | 'signalingstatechange', value: string, state: PeerConnectionState}
    //The state after a change of the transceivers by the main thread
    | {type: 'state', conn: number, state: PeerConnectionState}
    | {type: 'datachannel', conn: number, ch: string, info: PeerChannelInfo}
    | {type: 'channelState', conn: number, ch: string, readyState: PeerChannelInfo['readyState'], id: number | null}
    | {type: 'message', conn: number, ch: string, data: (string | Uint8Array)[]}
    //The amount the engine buffers, and the bytes of the messages of the main thread it was given so far
    | {type: 'buffered', conn: number, ch: string, amount: number, applied: number}
    | {type: 'channelError', conn: number, ch: string, error: {name: string, message: string}}
    //A track received, with its transceiver and the ids of its streams
    | {type: 'track', conn: number, transceiver: PeerTransceiverInfo, streams: string[], state: PeerConnectionState}
    | {type: 'rtp', conn: number, track: string, packets: Uint8Array[], extensions: (Extensions | null)[]}
    | {type: 'trackEnded', conn: number, track: string}
    //The bytes of the RTP packets of the main thread read
    | {type: 'consumed', conn: number, rtp: number}
    //The other peer asks the sender of a transceiver for a key frame
    | {type: 'pli', conn: number, transceiver: string}
    | {type: 'log', namespace: string, message: string}
