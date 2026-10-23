import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import type {EngineOptions} from './EngineConfig.js'

/**
 * What a worker thread of connections is started with
 */
export interface PeerWorkerData {
    readonly thread: number
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
 * The messages of the main thread to a worker thread of connections (`conn` is the connection, `ch` a channel)
 */
export type PeerToWorker =
    {type: 'open', conn: number, options: EngineOptions}
    | {type: 'call', conn: number} & PeerCall
    | {type: 'close', conn: number}
    | {type: 'restartIce', conn: number}
    | {type: 'setConfiguration', conn: number, configuration: {iceServers?: SignalingIceServer[], iceTransportPolicy?: 'all' | 'relay'}}
    | {type: 'channel', conn: number, ch: string, label: string, options: DataChannelOptions}
    | {type: 'send', conn: number, ch: string, data: string | Uint8Array, binary: boolean}
    | {type: 'closeChannel', conn: number, ch: string}
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
    | {type: 'datachannel', conn: number, ch: string, info: PeerChannelInfo}
    | {type: 'channelState', conn: number, ch: string, readyState: PeerChannelInfo['readyState'], id: number | null}
    | {type: 'message', conn: number, ch: string, data: string | Uint8Array}
    //The amount the engine buffers, and the bytes of the messages of the main thread it was given so far
    | {type: 'buffered', conn: number, ch: string, amount: number, applied: number}
    | {type: 'channelError', conn: number, ch: string, error: {name: string, message: string}}
    | {type: 'log', namespace: string, message: string}
