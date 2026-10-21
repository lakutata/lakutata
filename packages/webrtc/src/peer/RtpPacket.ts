import {RtpHeader, RtpPacket as EngineRtpPacket} from '../lib/rtp/rtp/rtp.js'

/**
 * The fields of an {@link RtpPacket}.
 */
export interface RtpPacketInit {
    /**
     * The payload type: the codec of the payload, as the description numbers it.
     */
    payloadType: number
    /**
     * The sequence number, from 0 to 65535, one more for each packet.
     */
    sequenceNumber: number
    /**
     * The timestamp, in the units of the clock rate of the codec (90000 per second for the video, 48000 for Opus).
     */
    timestamp: number
    /**
     * The synchronization source: the id of the stream of packets.
     * @default 0
     */
    ssrc?: number
    /**
     * The marker: set on the last packet of a video frame.
     * @default false
     */
    marker?: boolean
    /**
     * The payload: a piece of encoded audio or video.
     */
    payload: Uint8Array
}

/**
 * An RTP packet: a piece of encoded audio or video, with the fields of its header the applications use. The packets of
 * a received {@link MediaTrack} come as these (its `rtp` event); a track to send takes these or the bytes of RTP
 * packets (`writeRtp()`), such as the ones an encoder like ffmpeg or GStreamer sends to a UDP port.
 * @example
 * ```typescript
 * import {RtpPacket} from '@lakutata/webrtc'
 *
 * declare const datagram: Buffer
 * //A packet read from the bytes an encoder sent
 * const packet: RtpPacket = RtpPacket.parse(datagram)
 * console.log(packet.payloadType, packet.sequenceNumber, packet.marker)
 * ```
 */
export class RtpPacket {

    /**
     * The payload type: the codec of the payload, as the description numbers it.
     */
    public payloadType: number

    /**
     * The sequence number, from 0 to 65535, one more for each packet.
     */
    public sequenceNumber: number

    /**
     * The timestamp, in the units of the clock rate of the codec.
     */
    public timestamp: number

    /**
     * The synchronization source: the id of the stream of packets.
     */
    public ssrc: number

    /**
     * The marker: set on the last packet of a video frame.
     */
    public marker: boolean

    /**
     * The payload: a piece of encoded audio or video.
     */
    public payload: Buffer

    /**
     * Create a packet.
     * @param init The fields of the packet.
     */
    constructor(init: RtpPacketInit) {
        this.payloadType = init.payloadType
        this.sequenceNumber = init.sequenceNumber
        this.timestamp = init.timestamp
        this.ssrc = init.ssrc ?? 0
        this.marker = init.marker ?? false
        this.payload = Buffer.isBuffer(init.payload) ? init.payload : Buffer.from(init.payload.buffer, init.payload.byteOffset, init.payload.byteLength)
    }

    /**
     * Read a packet from its bytes (its header extensions and contributing sources are left out).
     * @param data The bytes of an RTP packet.
     * @returns The packet.
     * @example
     * ```typescript
     * import {RtpPacket} from '@lakutata/webrtc'
     *
     * declare const datagram: Buffer
     * const packet: RtpPacket = RtpPacket.parse(datagram)
     * ```
     */
    public static parse(data: Uint8Array): RtpPacket {
        return rtpPacketOf(EngineRtpPacket.deSerialize(Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)))
    }

    /**
     * The bytes of the packet.
     * @returns The bytes.
     * @example
     * ```typescript
     * import {RtpPacket} from '@lakutata/webrtc'
     *
     * const packet: RtpPacket = new RtpPacket({payloadType: 96, sequenceNumber: 1, timestamp: 3000, payload: Buffer.from([0x10])})
     * const bytes: Buffer = packet.toBuffer()
     * ```
     */
    public toBuffer(): Buffer {
        return enginePacketOf(this).serialize()
    }
}

/**
 * The packet of a packet of the engine
 * @param packet
 */
export function rtpPacketOf(packet: EngineRtpPacket): RtpPacket {
    const {header} = packet
    return new RtpPacket({
        payloadType: header.payloadType,
        sequenceNumber: header.sequenceNumber,
        timestamp: header.timestamp,
        ssrc: header.ssrc,
        marker: header.marker,
        payload: packet.payload
    })
}

/**
 * The packet of the engine of a packet
 * @param packet
 */
export function enginePacketOf(packet: RtpPacket): EngineRtpPacket {
    return new EngineRtpPacket(new RtpHeader({
        payloadType: packet.payloadType,
        sequenceNumber: packet.sequenceNumber,
        timestamp: packet.timestamp,
        ssrc: packet.ssrc,
        marker: packet.marker
    }), packet.payload)
}
