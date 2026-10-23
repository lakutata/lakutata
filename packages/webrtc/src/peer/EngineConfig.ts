import {useTWCC} from '../lib/peer/media/extension/rtcpFeedback.js'
import {useAbsSendTime, useAudioLevelIndication, useSdesMid, useTransportWideCC} from '../lib/peer/media/extension/rtpExtension.js'
import type {RTCPeerConnectionConfig} from '../lib/peer/peerConnection.js'
import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import {engineCodecsOf} from './MediaCodecs.js'

/**
 * The options of a connection the engine is configured from, plain data (given to a worker thread as they are)
 */
export interface EngineOptions {
    readonly iceServers: SignalingIceServer[]
    readonly iceTransportPolicy: 'all' | 'relay'
    readonly icePortRange?: [number, number]
    readonly iceAdditionalHostAddresses?: string[]
    readonly iceUseIpv4: boolean
    readonly iceUseIpv6: boolean
    readonly codecs: string[]
    readonly headerExtensions: boolean
}

/**
 * The configuration of the connection of the engine of a connection
 * @param options
 */
export function engineConfigOf(options: EngineOptions): RTCPeerConnectionConfig {
    const config: RTCPeerConnectionConfig = {
        iceServers: options.iceServers,
        iceTransportPolicy: options.iceTransportPolicy,
        iceUseIpv4: options.iceUseIpv4,
        iceUseIpv6: options.iceUseIpv6,
        codecs: engineCodecsOf(options.codecs),
        //The largest message the other peer may send, as Chrome accepts (below the SCTP window of 1 MiB)
        maxMessageSize: 262144
    }
    if (options.icePortRange) config.icePortRange = options.icePortRange
    if (options.iceAdditionalHostAddresses) config.iceAdditionalHostAddresses = options.iceAdditionalHostAddresses
    if (options.headerExtensions) {
        //The ids of Chrome and Safari: a browser rolling back an offer of its own keeps its ids, and refuses others
        config.headerExtensions = {
            audio: [useAudioLevelIndication(), useAbsSendTime(), useTransportWideCC(), useSdesMid()],
            video: [useAbsSendTime(), useTransportWideCC(), useSdesMid()]
        }
        //The feedback of the transport-wide sequence numbers
        for (const codec of [...config.codecs!.audio!, ...config.codecs!.video!]) codec.rtcpFeedback.push(useTWCC())
    }
    return config
}
