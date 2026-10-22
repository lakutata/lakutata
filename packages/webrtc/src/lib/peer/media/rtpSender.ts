/**
   [10 Nov 1995 11:33:25.125 UTC]       [10 Nov 1995 11:33:36.5 UTC]
   n                 SR(n)              A=b710:8000 (46864.500 s)
   ---------------------------------------------------------------->
                      v                 ^
   ntp_sec =0xb44db705 v               ^ dlsr=0x0005:4000 (    5.250s)
   ntp_frac=0x20000000  v             ^  lsr =0xb705:2000 (46853.125s)
     (3024992005.125 s)  v           ^
   r                      v         ^ RR(n)
   ---------------------------------------------------------------->
                          |<-DLSR->|
                           (5.250 s)
        
   A     0xb710:8000 (46864.500 s)
   DLSR -0x0005:4000 (    5.250 s)
   LSR  -0xb705:2000 (46853.125 s)
   -------------------------------
   delay 0x0006:2000 (    6.125 s)
        
Figure 2: Example for round-trip time computation
 */

import {randomBytes, randomUUID} from 'node:crypto'
import {setTimeout} from 'node:timers/promises'
import {Event, detached, random16, uint16Add, uint32Add} from '../imports/common.js'

import {codecParametersFromString} from '../index.js'
import {createWebRtcDomException} from '../errors.js'
import {
    type AudioLevelIndicationPayload,
    type Extension,
    type Extensions,
    GenericNack,
    PictureLossIndication,
    RTP_EXTENSION_URI,
    ReceiverEstimatedMaxBitrate,
    RedEncoder,
    type RtcpPacket,
    RtcpPayloadSpecificFeedback,
    RtcpRrPacket,
    RtcpSenderInfo,
    RtcpSourceDescriptionPacket,
    RtcpSrPacket,
    RtcpTransportLayerFeedback,
    RtpHeader,
    RtpPacket,
    SourceDescriptionChunk,
    SourceDescriptionItem,
    debug,
    serializeAbsSendTime,
    serializeRepairedRtpStreamId,
    serializeSdesMid,
    serializeSdesRTPStreamID,
    serializeTransportWideCC,
    type videoOrientationPayload,
    wrapRtx
} from '../imports/rtp.js'
import type {RTCDtlsTransport} from '../transport/dtls.js'
import type {Kind} from '../types/domain.js'
import {compactNtp, milliTime, ntpTime, timestampSeconds} from '../utils.js'
import {isCodecCompatible} from './codecCompatibility.js'
import type {
    RTCRtpCodecParameters,
    RTCRtpHeaderExtensionParameters,
    RTCRtpSendParameters
} from './parameters.js'
import type {SentInfo} from './sender/senderBWE.js'
import {
    type RTCCodecStats,
    type RTCMediaSourceStats,
    type RTCOutboundRtpStreamStats,
    type RTCRemoteInboundRtpStreamStats,
    type RTCStats,
    type RTCStatsReport,
    buildStatsReport,
    generateCodecStatsId,
    generateStatsId,
    getStatsTimestamp
} from './stats.js'
import {
    type MediaStream,
    type MediaStreamTrack,
    captureTrackSourceCodecs,
    getTrackSourceCodecs
} from './track.js'

const log = debug('webrtc/peer/media/rtpSender')

const RTP_HISTORY_SIZE = 128
const DEFAULT_PENDING_RTP_MAX_LENGTH = 256
const RTT_ALPHA = 0.85

export type PendingRtpOptions = {
    /** Queue RTP until DTLS is connected and a codec is set. Default true when this object is passed. */
    enabled?: boolean
    /** Max queued packets when enabled. Oldest packets are dropped. Default 256. */
    maxLength?: number
}

export type RTCRtpSenderOptions = {
    /** Pending RTP cache. Disabled by default. Pass `true` or `{ maxLength }` to enable. */
    pendingRtp?: boolean | PendingRtpOptions
}

type PendingRtpItem = {
    packet: RtpPacket
    resolve: () => void
    reject: (error: unknown) => void
}

function resolvePendingRtpOptions(
    pendingRtp: RTCRtpSenderOptions['pendingRtp']
): {enabled: boolean, maxLength: number} {
    if (pendingRtp === true) {
        return {enabled: true, maxLength: DEFAULT_PENDING_RTP_MAX_LENGTH}
    }
    if (pendingRtp == undefined || pendingRtp === false) {
        return {enabled: false, maxLength: DEFAULT_PENDING_RTP_MAX_LENGTH}
    }
    const maxLength =
        typeof pendingRtp.maxLength === 'number' &&
    Number.isFinite(pendingRtp.maxLength) &&
    pendingRtp.maxLength >= 1
            ? Math.floor(pendingRtp.maxLength)
            : DEFAULT_PENDING_RTP_MAX_LENGTH
    return {enabled: pendingRtp.enabled ?? true, maxLength}
}

function freezeRtpContinuityOffsets(
    lastOutputSeq: number,
    lastOutputTimestamp: number,
    firstInputSeq: number,
    firstInputTimestamp: number,
    timestampStep: number
) {
    return {
        seqOffset: uint16Add(uint16Add(lastOutputSeq, 1), -firstInputSeq),
        timestampOffset: uint32Add(
            uint32Add(lastOutputTimestamp, timestampStep),
            -firstInputTimestamp
        )
    }
}

export class RTCRtpSender {
    readonly type = 'sender'
    readonly kind: Kind
    readonly ssrc = randomBytes(4).readUInt32BE(0)
    readonly rtxSsrc = randomBytes(4).readUInt32BE(0)
    readonly trackId = randomUUID().toString()
    readonly onReady = new Event()
    readonly onRtcp = new Event<[RtcpPacket]>()
    readonly onPictureLossIndication = new Event<[]>()
    readonly onGenericNack = new Event<[GenericNack]>()

    private cname?: string
    private mid?: string
    private rtpStreamId?: string
    private repairedRtpStreamId?: string
    private rtxPayloadType?: number
    private rtxSequenceNumber = random16()
    redRedundantPayloadType?: number
    private _redDistance = 2
    redEncoder = new RedEncoder(this._redDistance)
    private headerExtensions: RTCRtpHeaderExtensionParameters[] = []
    private disposeTrack?: () => void
    private sendEncodings: Array<Record<string, unknown>> = [{}]

    // # stats
    private lastSRtimestamp?: number
    private lastSentSRTimestamp?: number
    private ntpTimestamp = 0n
    private rtpTimestamp = 0
    private octetCount = 0
    private packetCount = 0
    private headerBytesSent = 0
    private rtt?: number
    private totalRoundTripTime = 0
    private roundTripTimeMeasurements = 0
    private retransmittedPacketsSent = 0
    private retransmittedBytesSent = 0
    private nackCount = 0
    private pliCount = 0
    private firCount = 0
    private remotePacketsLost?: number
    private remoteFractionLost?: number
    receiverEstimatedMaxBitrate = 0n

    // rtp
    private sequenceNumber?: number
    private timestamp?: number
    private timestampOffset = 0
    private seqOffset = 0
    private rtpContinuityPending = false
    private pendingTimestampStep = 1
    private rtpCache: RtpPacket[] = []
    private pendingRtp: PendingRtpItem[] = []
    private drainingPendingRtp = false
    private readonly pendingRtpEnabled: boolean
    private readonly pendingRtpMaxLength: number
    codec?: RTCRtpCodecParameters
    private negotiatedCodecs: RTCRtpCodecParameters[] = []
    private sendPrimaryCodec?: RTCRtpCodecParameters
    public dtlsTransport!: RTCDtlsTransport
    private dtlsDisposer: (() => void)[] = []

    track: MediaStreamTrack | null = null
    streamIds: string[] = []
    stopped = false
    rtcpRunning = false
    private rtcpCancel = new AbortController()

    constructor(
        public trackOrKind: Kind | MediaStreamTrack,
        options: RTCRtpSenderOptions = {}
    ) {
        const pendingRtp = resolvePendingRtpOptions(options.pendingRtp)
        this.pendingRtpEnabled = pendingRtp.enabled
        this.pendingRtpMaxLength = pendingRtp.maxLength
        this.kind =
            typeof this.trackOrKind === 'string'
                ? this.trackOrKind
                : this.trackOrKind.kind
        if (typeof trackOrKind !== 'string') {
            this.registerTrack(trackOrKind)
        }
    }

    get transport() {
        return this.dtlsTransport ?? null
    }

    get streamId() {
        return this.streamIds[0]
    }

    set streamId(value: string | undefined) {
        this.streamIds = value ? [value] : []
    }

    setDtlsTransport(dtlsTransport: RTCDtlsTransport) {
        if (this.dtlsTransport) {
            this.dtlsDisposer.forEach((dispose) => dispose())
        }

        this.dtlsTransport = dtlsTransport
        this.dtlsDisposer = [
            this.dtlsTransport.onStateChange.subscribe((state) => {
                if (state === 'connected') {
                    this.onReady.execute()
                    void this.drainPendingRtp()
                }
            }).unSubscribe
        ]
    }

    get redDistance() {
        return this._redDistance
    }
    set redDistance(n: number) {
        this._redDistance = n
        this.redEncoder.distance = n
    }

    prepareSend(params: RTCRtpSendParameters) {
        this.cname = params.rtcp?.cname
        this.mid = params.muxId
        this.headerExtensions = params.headerExtensions
        this.rtpStreamId = params.rtpStreamId ?? this.rtpStreamId
        this.repairedRtpStreamId = params.repairedRtpStreamId

        this.negotiatedCodecs = [...params.codecs]
        this.codec =
            params.codecs.find((codec) => codec.name.toLowerCase() !== 'rtx') ??
      params.codecs[0]
        const redPrimaryPayloadType =
            this.codec?.name.toLowerCase() === 'red'
                ? Number((this.codec.parameters ?? '').split('/')[0])
                : undefined
        this.sendPrimaryCodec =
            this.codec?.name.toLowerCase() === 'red'
                ? params.codecs.find(
                    (codec) =>
                        !['red', 'rtx'].includes(codec.name.toLowerCase()) &&
              codec.payloadType === redPrimaryPayloadType
                )
                : this.codec
        if (this.track) {
            this.track.codec = this.codec
        }

        this.rtxPayloadType = undefined
        this.redRedundantPayloadType = undefined
        params.codecs.forEach((codec) => {
            const codecParams = codecParametersFromString(codec.parameters ?? '')
            if (
                codec.name.toLowerCase() === 'rtx' &&
        this.sendPrimaryCodec?.payloadType === codecParams['apt']
            ) {
                this.rtxPayloadType = codec.payloadType
            }
        })
        if (
            this.codec?.name.toLowerCase() === 'red' &&
      this.sendPrimaryCodec != undefined
        ) {
            this.redRedundantPayloadType = this.sendPrimaryCodec.payloadType
        }
        void this.drainPendingRtp()
    }

    private canSendRtp() {
        return (
            !this.stopped && this.dtlsTransport?.state === 'connected' && !!this.codec
        )
    }

    private settlePendingRtp(item: PendingRtpItem, error?: unknown) {
        if (error == undefined) {
            item.resolve()
            return
        }
        item.reject(error)
    }

    private discardPendingRtp() {
        const dropped = this.pendingRtp.splice(0)
        for (const item of dropped) {
            this.settlePendingRtp(item)
        }
    }

    private enqueuePendingRtp(
        rtp: Buffer | RtpPacket,
        resolve: () => void,
        reject: (error: unknown) => void
    ) {
        const packet = Buffer.isBuffer(rtp)
            ? RtpPacket.deSerialize(rtp)
            : rtp.clone()
        this.pendingRtp.push({packet, resolve, reject})
        while (this.pendingRtp.length > this.pendingRtpMaxLength) {
            const dropped = this.pendingRtp.shift()
            if (dropped) {
                this.settlePendingRtp(dropped)
            }
        }
    }

    /**
   * Send queued RTP once DTLS is connected and a codec is set. Used only when
   * pending RTP is enabled: `writeRtp` / `sendRtp` may run before ICE/DTLS
   * completes; dropping those packets would lose the start of a media source.
   * `drainingPendingRtp` blocks re-entry while `dispatchRtp` is awaited;
   * packets enqueued during that wait are drained by the recursive call after
   * the flag is cleared.
   */
    private async drainPendingRtp() {
        if (this.drainingPendingRtp) {
            return
        }
        this.drainingPendingRtp = true
        try {
            while (this.pendingRtp.length > 0 && this.canSendRtp()) {
                const item = this.pendingRtp.shift()!
                if (!this.canSendRtp()) {
                    this.settlePendingRtp(item)
                    continue
                }
                try {
                    await this.dispatchRtp(item.packet)
                    this.settlePendingRtp(item)
                } catch (error) {
                    this.settlePendingRtp(item, error)
                }
            }
        } finally {
            this.drainingPendingRtp = false
        }
        if (this.pendingRtp.length > 0 && this.canSendRtp()) {
            await this.drainPendingRtp()
        }
    }

    registerTrack(track: MediaStreamTrack) {
        if (track.stopped) throw new Error('track is ended')

        captureTrackSourceCodecs(track)

        if (this.disposeTrack) {
            this.disposeTrack()
        }

        track.id = this.trackId

        const {unSubscribe: unSubscribeRtp} = track.onReceiveRtp.subscribe(
            detached(
                (rtp, extensions) =>
                    this.sendRtp(track.remote ? this.relayedRtp(rtp, extensions) : rtp),
                (error) => log('send rtp failed', error)
            )
        )
        const {unSubscribe: unSubscribeSourceChanged} =
            track.onSourceChanged.subscribe((header) => {
                this.replaceRTP(header)
            })
        this.track = track
        this.disposeTrack = () => {
            unSubscribeRtp()
            unSubscribeSourceChanged()
        }

        if (this.codec) {
            track.codec = this.codec
        }
    }

    /**
     * A packet received on a connection, to send on this one: its header extensions are the ones of that connection,
     * by their ids there. The ones about the media (the audio level, the video orientation) go on with their ids here,
     * if negotiated; the ones of the transport are this connection's own.
     * @param rtp
     * @param extensions The extensions of the packet, by URI
     */
    private relayedRtp(rtp: RtpPacket, extensions: Extensions = {}) {
        const packet = rtp.clone()
        packet.header.extensions = this.headerExtensions.flatMap((extension) => {
            switch (extension.uri) {
                case RTP_EXTENSION_URI.audioLevelIndication: {
                    const level = extensions[extension.uri] as AudioLevelIndicationPayload | undefined
                    return level
                        ? [{id: extension.id, payload: Buffer.from([(level.v ? 0x80 : 0) | (level.level & 0x7f)])}]
                        : []
                }
                case RTP_EXTENSION_URI.videoOrientation: {
                    const orientation = extensions[extension.uri] as videoOrientationPayload | undefined
                    return orientation
                        ? [{
                            id: extension.id,
                            payload: Buffer.from([
                                (orientation.c << 3) | (orientation.f << 2) | (orientation.r1 << 1) | orientation.r0
                            ])
                        }]
                        : []
                }
                default:
                    return []
            }
        })
        return packet
    }

    setStreams(streams: MediaStream[] = []) {
        this.streamIds = [...new Set(streams.map((stream) => stream.id))]
    }

    setSendEncodings(encodings: Array<Record<string, unknown>> = []) {
        this.sendEncodings =
            encodings.length > 0
                ? encodings.map((encoding) => ({...encoding}))
                : [{}]
        const rid = this.sendEncodings.find(
            (encoding) => typeof encoding.rid === 'string'
        )?.rid
        if (typeof rid === 'string') {
            this.rtpStreamId = rid
        }
    }

    async replaceTrack(track: MediaStreamTrack | null) {
        if (track === null) {
            this.detachTrack()
            return
        }

        if (track.stopped) throw new Error('track is ended')

        captureTrackSourceCodecs(track)
        const sourceCodecs = getTrackSourceCodecs(track)
        if (
            this.sendPrimaryCodec != undefined &&
      sourceCodecs != undefined &&
      !sourceCodecs.some((source) =>
          isCodecCompatible(source, this.sendPrimaryCodec!)
      )
        ) {
            throw createWebRtcDomException(
                'InvalidModificationError',
                `Track codec ${sourceCodecs.map((codec) => codec.mimeType).join(', ')} is incompatible with negotiated codecs ${this.negotiatedCodecs.map((codec) => codec.mimeType).join(', ')}`
            )
        }

        if (this.sequenceNumber != undefined) {
            this.scheduleRtpContinuity()
        }

        this.registerTrack(track)
        log('replaceTrack', 'ssrc', track.ssrc, 'rid', track.rid)
    }

    /**
   * Detach the current track without stopping the sender (`removeTrack`).
   * The same sender can resume sending after `replaceTrack(track)`.
   */
    detachTrack() {
        this.rtpContinuityPending = false
        this.discardPendingRtp()
        if (this.disposeTrack) {
            this.disposeTrack()
            this.disposeTrack = undefined
        }
        this.track = null
    }

    stop({keepTrack = false}: {keepTrack?: boolean} = {}) {
        this.stopped = true
        this.rtpContinuityPending = false
        this.discardPendingRtp()
        this.rtcpRunning = false
        this.rtcpCancel.abort()
        if (this.disposeTrack) {
            this.disposeTrack()
            this.disposeTrack = undefined
        }
        if (!keepTrack) {
            this.track = null
        }
    }

    async runRtcp() {
        if (this.rtcpRunning || this.stopped) return
        this.rtcpRunning = true

        try {
            while (this.rtcpRunning) {
                await setTimeout(500 + Math.random() * 1000, undefined, {
                    signal: this.rtcpCancel.signal
                })

                const packets: RtcpPacket[] = [
                    new RtcpSrPacket({
                        ssrc: this.ssrc,
                        senderInfo: new RtcpSenderInfo({
                            ntpTimestamp: this.ntpTimestamp,
                            rtpTimestamp: this.rtpTimestamp,
                            packetCount: this.packetCount,
                            octetCount: this.octetCount
                        })
                    })
                ]
                this.lastSRtimestamp = compactNtp(this.ntpTimestamp)
                this.lastSentSRTimestamp = timestampSeconds()

                if (this.cname) {
                    packets.push(
                        new RtcpSourceDescriptionPacket({
                            chunks: [
                                new SourceDescriptionChunk({
                                    source: this.ssrc,
                                    items: [
                                        new SourceDescriptionItem({type: 1, text: this.cname})
                                    ]
                                })
                            ]
                        })
                    )
                }

                try {
                    await this.dtlsTransport.sendRtcp(packets)
                } catch (error) {
                    log('sendRtcp failed', error)
                    await setTimeout(500 + Math.random() * 1000)
                }
            }
        } catch (error) {
            //The loop of the RTCP reports ends with the transport
            log('rtcp loop ended', error)
        }
    }

    /**
   * Send an RTP packet. Pending RTP is disabled by default: the packet is
   * written immediately if DTLS is connected and a codec is set, otherwise
   * dropped.
   *
   * When pending RTP is enabled, the packet is queued until it can be sent.
   * The returned promise then settles for this packet only:
   * - resolve: DTLS send completed, or the packet was dropped by `stop()`,
   *   `replaceTrack(null)`, or pending-queue overflow
   * - reject: DTLS send threw while writing this packet
   *
   * Later `sendRtp()` calls stay pending until their own packet is sent or
   * dropped, even if a drain is already in progress.
   */
    async sendRtp(rtp: Buffer | RtpPacket) {
        if (this.stopped) {
            return
        }
        if (!this.pendingRtpEnabled) {
            if (!this.canSendRtp()) {
                return
            }
            await this.dispatchRtp(rtp)
            return
        }
        await new Promise<void>((resolve, reject) => {
            this.enqueuePendingRtp(rtp, resolve, reject)
            void this.drainPendingRtp()
        })
    }

    /**
   * Schedule RTP continuity rewrite for the next packet that is actually sent.
   * The header argument is kept for API compatibility and is not used to compute
   * offsets. `discontinuity` does not change sequence or timestamp mapping.
   * `timestampStep` (default 1) is the only way to choose the timestamp increment
   * at the source-switch boundary.
   */
    replaceRTP(
        header: Pick<RtpHeader, 'sequenceNumber' | 'timestamp'>,
        discontinuity = false,
        timestampStep = 1
    ) {
        this.scheduleRtpContinuity(timestampStep)
        log(
            'replaceRTP',
            this.sequenceNumber,
            header.sequenceNumber,
            discontinuity,
            timestampStep
        )
    }

    private scheduleRtpContinuity(timestampStep = 1) {
        this.rtpContinuityPending = true
        this.pendingTimestampStep = timestampStep
        this.rtpCache = []
    }

    private async dispatchRtp(rtp: Buffer | RtpPacket) {
        if (!this.canSendRtp()) {
            return
        }

        const codec = this.codec
        if (!codec) {
            return
        }

        rtp = Buffer.isBuffer(rtp) ? RtpPacket.deSerialize(rtp) : rtp.clone()

        const {header, payload} = rtp
        const inputSequenceNumber = header.sequenceNumber
        const inputTimestamp = header.timestamp

        if (this.rtpContinuityPending) {
            if (this.sequenceNumber != undefined && this.timestamp != undefined) {
                const offsets = freezeRtpContinuityOffsets(
                    this.sequenceNumber,
                    this.timestamp,
                    inputSequenceNumber,
                    inputTimestamp,
                    this.pendingTimestampStep
                )
                this.seqOffset = offsets.seqOffset
                this.timestampOffset = offsets.timestampOffset
            }
            this.rtpContinuityPending = false
            this.pendingTimestampStep = 1
        }

        header.ssrc = this.ssrc
        header.payloadType = codec.payloadType
        header.timestamp = uint32Add(header.timestamp, this.timestampOffset)
        header.sequenceNumber = uint16Add(header.sequenceNumber, this.seqOffset)
        this.timestamp = header.timestamp
        this.sequenceNumber = header.sequenceNumber

        const ntpTimestamp = ntpTime()
        let transportSequenceNumber: number | undefined

        const originalHeaderExtensions = [...header.extensions]
        header.extensions = this.headerExtensions
            .map((extension) => {
                const payload = (() => {
                    switch (extension.uri) {
                        case RTP_EXTENSION_URI.sdesMid:
                            if (this.mid) {
                                return serializeSdesMid(this.mid)
                            }
                            return
                            // todo : sender simulcast unsupported now
                        case RTP_EXTENSION_URI.sdesRTPStreamID:
                            if (this.rtpStreamId) {
                                return serializeSdesRTPStreamID(this.rtpStreamId)
                            }
                            return
                            // todo : sender simulcast unsupported now
                        case RTP_EXTENSION_URI.repairedRtpStreamId:
                            if (this.repairedRtpStreamId) {
                                return serializeRepairedRtpStreamId(this.repairedRtpStreamId)
                            }
                            return
                        case RTP_EXTENSION_URI.transportWideCC:
                            transportSequenceNumber = this.nextTransportSequenceNumber()
                            return serializeTransportWideCC(transportSequenceNumber)
                        case RTP_EXTENSION_URI.absSendTime:
                            return serializeAbsSendTime(ntpTimestamp)
                    }
                })()

                if (payload) return {id: extension.id, payload}
            })
            .filter((v) => v) as Extension[]
        for (const ext of originalHeaderExtensions) {
            const exist = header.extensions.find((v) => v.id === ext.id)
            if (exist) {
                exist.payload = ext.payload
            } else {
                header.extensions.push(ext)
            }
        }
        header.extensions = header.extensions.sort((a, b) => a.id - b.id)

        this.ntpTimestamp = ntpTimestamp
        this.rtpTimestamp = header.timestamp
        this.octetCount += payload.length
        this.headerBytesSent += header.serializeSize
        this.packetCount = uint32Add(this.packetCount, 1)

        this.rtpCache[header.sequenceNumber % RTP_HISTORY_SIZE] = rtp

        let rtpPayload = payload

        if (this.redRedundantPayloadType) {
            this.redEncoder.push({
                block: rtpPayload,
                timestamp: header.timestamp,
                blockPT: this.redRedundantPayloadType
            })
            const red = this.redEncoder.build()
            rtpPayload = red.serialize()
        }

        const sendingAtMs = milliTime()
        const size = await this.dtlsTransport.sendRtp(rtpPayload, header)

        this.runRtcp().catch((error) => log('rtcp failed', error))
        if (transportSequenceNumber !== undefined) {
            this.packetSent(transportSequenceNumber, size, sendingAtMs)
        }
    }

    /**
     * The next transport-wide sequence number, shared by the senders of the transport
     */
    private nextTransportSequenceNumber() {
        this.dtlsTransport.transportSequenceNumber = uint16Add(
            this.dtlsTransport.transportSequenceNumber,
            1
        )
        return this.dtlsTransport.transportSequenceNumber
    }

    /**
     * A packet sent with a transport-wide sequence number, for the bandwidth estimation of the transport
     * @param wideSeq
     * @param size
     * @param sendingAtMs
     */
    private packetSent(wideSeq: number, size: number, sendingAtMs: number) {
        const sentInfo: SentInfo = {
            wideSeq,
            size,
            sendingAtMs,
            sentAtMs: milliTime()
        }
        this.dtlsTransport.senderBWE.rtpPacketSent(sentInfo)
    }

    /**
     * Send a packet again, for a negative acknowledgement: with a new transport-wide sequence number and send time, in
     * a retransmission packet when RTX is negotiated
     * @param cached
     */
    private async resendRtp(cached: RtpPacket) {
        let transportSequenceNumber: number | undefined
        const extensions = cached.header.extensions.map((extension) => {
            const uri = this.headerExtensions.find(
                (negotiated) => negotiated.id === extension.id
            )?.uri
            switch (uri) {
                case RTP_EXTENSION_URI.transportWideCC:
                    transportSequenceNumber = this.nextTransportSequenceNumber()
                    return {id: extension.id, payload: serializeTransportWideCC(transportSequenceNumber)}
                case RTP_EXTENSION_URI.absSendTime:
                    return {id: extension.id, payload: serializeAbsSendTime(ntpTime())}
                default:
                    return extension
            }
        })
        let packet = new RtpPacket(
            new RtpHeader({...cached.header, extensions}),
            cached.payload
        )
        if (this.rtxPayloadType != undefined) {
            packet = wrapRtx(
                packet,
                this.rtxPayloadType,
                this.rtxSequenceNumber,
                this.rtxSsrc
            )
            this.rtxSequenceNumber = uint16Add(this.rtxSequenceNumber, 1)
        }
        this.retransmittedPacketsSent++
        this.retransmittedBytesSent += packet.payload.length
        this.headerBytesSent += packet.header.serializeSize
        const sendingAtMs = milliTime()
        const size = await this.dtlsTransport.sendRtp(packet.payload, packet.header)
        if (transportSequenceNumber !== undefined) {
            this.packetSent(transportSequenceNumber, size, sendingAtMs)
        }
    }

    handleRtcpPacket(rtcpPacket: RtcpPacket) {
        switch (rtcpPacket.type) {
            case RtcpSrPacket.type:
            case RtcpRrPacket.type:
                {
                    const packet = rtcpPacket as RtcpSrPacket | RtcpRrPacket
                    packet.reports
                        .filter((report) => report.ssrc === this.ssrc)
                        .forEach((report) => {
                            this.remotePacketsLost = report.packetsLost
                            this.remoteFractionLost = report.fractionLost / 256
                            if (this.lastSRtimestamp === report.lsr && report.dlsr) {
                                if (this.lastSentSRTimestamp) {
                                    const rtt =
                                        timestampSeconds() -
                    this.lastSentSRTimestamp -
                    report.dlsr / 65536
                                    this.totalRoundTripTime += rtt
                                    this.roundTripTimeMeasurements++
                                    if (this.rtt === undefined) {
                                        this.rtt = rtt
                                    } else {
                                        this.rtt = RTT_ALPHA * this.rtt + (1 - RTT_ALPHA) * rtt
                                    }
                                }
                            }
                        })
                }
                break
            case RtcpTransportLayerFeedback.type:
                {
                    const packet = rtcpPacket as RtcpTransportLayerFeedback
                    switch (packet.feedback.count) {
                        case GenericNack.count:
                            {
                                const feedback = packet.feedback as GenericNack
                                this.nackCount++
                                feedback.lost.forEach(detached(async (seqNum: number) => {
                                    const packet: RtpPacket | undefined =
                                        this.rtpCache[seqNum % RTP_HISTORY_SIZE]
                                    if (packet && packet.header.sequenceNumber === seqNum) {
                                        await this.resendRtp(packet)
                                    }
                                }, (error) => log('retransmission failed', error)))
                                this.onGenericNack.execute(feedback)
                            }
                            break
                    }
                }
                break
            case RtcpPayloadSpecificFeedback.type:
                {
                    const packet = rtcpPacket as RtcpPayloadSpecificFeedback
                    switch (packet.feedback.count) {
                        case ReceiverEstimatedMaxBitrate.count:
                            {
                                const feedback = packet.feedback as ReceiverEstimatedMaxBitrate
                                this.receiverEstimatedMaxBitrate = feedback.bitrate
                            }
                            break
                        case PictureLossIndication.count:
                            {
                                this.pliCount++
                                this.onPictureLossIndication.execute()
                            }
                            break
                    }
                }
                break
        }
        this.onRtcp.execute(rtcpPacket)
    }

    // todo impl
    getParameters() {
        return {
            encodings: this.sendEncodings.map((encoding) => ({...encoding}))
        }
    }

    // todo impl
    setParameters(params: {encodings?: Array<Record<string, unknown>>}) {
        if (params.encodings) {
            this.setSendEncodings(params.encodings)
        }
    }

    private get outboundRtpStatsId() {
        return generateStatsId('outbound-rtp', this.trackId)
    }

    private get mediaSourceStatsId() {
        return generateStatsId('media-source', this.trackId)
    }

    private get remoteInboundRtpStatsId() {
        return generateStatsId('remote-inbound-rtp', this.trackId)
    }

    getStatsRootIds() {
        return [this.outboundRtpStatsId]
    }

    collectStats(timestamp: number): RTCStats[] {
        const stats: RTCStats[] = []
        const transportId = this.dtlsTransport
            ? generateStatsId('transport', this.dtlsTransport.id)
            : undefined
        const codecId =
            this.codec && transportId
                ? generateCodecStatsId(
                    transportId,
                    this.codec.payloadType,
                    this.trackId
                )
                : undefined

        // Outbound RTP stats
        const outboundRtpStats: RTCOutboundRtpStreamStats = {
            type: 'outbound-rtp',
            id: this.outboundRtpStatsId,
            timestamp,
            ssrc: this.ssrc,
            kind: this.kind,
            transportId,
            codecId,
            mid: this.mid,
            packetsSent: this.packetCount,
            bytesSent: this.octetCount,
            headerBytesSent: this.headerBytesSent,
            retransmittedPacketsSent: this.retransmittedPacketsSent || undefined,
            retransmittedBytesSent: this.retransmittedBytesSent || undefined,
            rtxSsrc: this.rtxPayloadType ? this.rtxSsrc : undefined,
            mediaSourceId: this.track ? this.mediaSourceStatsId : undefined,
            remoteId:
        this.rtt !== undefined ||
        this.remotePacketsLost !== undefined ||
        this.remoteFractionLost !== undefined
            ? this.remoteInboundRtpStatsId
            : undefined,
            nackCount: this.nackCount || undefined,
            pliCount: this.pliCount || undefined,
            firCount: this.firCount || undefined
        }
        stats.push(outboundRtpStats)

        // Media source stats
        if (this.track) {
            const mediaSourceStats: RTCMediaSourceStats = {
                type: 'media-source',
                id: this.mediaSourceStatsId,
                timestamp,
                trackIdentifier: this.track.id ?? this.trackId,
                kind: this.kind
            }
            stats.push(mediaSourceStats)
        }

        if (this.codec && transportId) {
            const codecStats: RTCCodecStats = {
                type: 'codec',
                id: codecId!,
                timestamp,
                payloadType: this.codec.payloadType,
                transportId,
                mimeType: this.codec.mimeType,
                clockRate: this.codec.clockRate,
                channels: this.codec.channels,
                sdpFmtpLine: this.codec.parameters
            }
            stats.push(codecStats)
        }

        // Remote inbound RTP stats (if we have RTT)
        if (
            this.rtt !== undefined ||
      this.remotePacketsLost !== undefined ||
      this.remoteFractionLost !== undefined
        ) {
            const remoteInboundStats: RTCRemoteInboundRtpStreamStats = {
                type: 'remote-inbound-rtp',
                id: this.remoteInboundRtpStatsId,
                timestamp,
                ssrc: this.ssrc,
                kind: this.kind,
                transportId,
                codecId: outboundRtpStats.codecId,
                localId: outboundRtpStats.id,
                roundTripTime: this.rtt,
                totalRoundTripTime: this.totalRoundTripTime,
                roundTripTimeMeasurements: this.roundTripTimeMeasurements,
                packetsLost: this.remotePacketsLost,
                fractionLost: this.remoteFractionLost
            }
            stats.push(remoteInboundStats)
        }

        return stats
    }

    async getStats(): Promise<RTCStatsReport> {
        const timestamp = getStatsTimestamp()
        const stats = this.collectStats(timestamp)

        if (this.dtlsTransport) {
            stats.push(...(await this.dtlsTransport.getStats(timestamp)))
        }

        return buildStatsReport(stats, this.getStatsRootIds())
    }
}
