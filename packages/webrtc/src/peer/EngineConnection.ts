import type {RTCDataChannel} from '../lib/peer/dataChannel.js'
import type {RTCPeerConnection} from '../lib/peer/peerConnection.js'
import type {PeerChannel} from './PeerChannel.js'
import type {PeerConnection} from './PeerConnection.js'

/**
 * The connections of the engine of the connections
 */
export const engineConnections: WeakMap<PeerConnection, RTCPeerConnection> = new WeakMap()

/**
 * The connection of the engine of a connection: its transports, its senders and receivers
 * @param connection
 */
export function engineConnectionOf(connection: PeerConnection): RTCPeerConnection {
    return engineConnections.get(connection)!
}

/**
 * The channels of the engine of the channels
 */
export const engineChannels: WeakMap<PeerChannel, RTCDataChannel> = new WeakMap()

/**
 * The channel of the engine of a channel: its SCTP transport
 * @param channel
 */
export function engineChannelOf(channel: PeerChannel): RTCDataChannel {
    return engineChannels.get(channel)!
}
