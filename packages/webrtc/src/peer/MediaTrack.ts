import {EventEmitter} from 'node:events'
import type {RTCRtpCodecParameters} from '../lib/peer/media/parameters.js'
import type {RTCRtpReceiver} from '../lib/peer/media/rtpReceiver.js'
import {MediaStreamTrack} from '../lib/peer/media/track.js'
import type {Extensions, RtpPacket as EngineRtpPacket} from '../lib/rtp/index.js'
import {canonicalCodec, engineCodecOf} from './MediaCodecs.js'
import {RtpPacket, enginePacketOf, rtpPacketOf} from './RtpPacket.js'

/**
 * The kind of a track.
 */
export type MediaKind = 'audio' | 'video'

/**
 * The options of a {@link MediaTrack} to send.
 */
export interface MediaTrackOptions {
    /**
     * The codec of the packets written to the track, as a MIME type: `audio/opus`, `audio/PCMU`, `video/VP8`,
     * `video/VP9` or `video/H264`. The connections sending the track negotiate this one; the other peer must support it.
     * @default the codec the connection negotiates (the packets written must then be of that codec)
     */
    codec?: string
    /**
     * The id of the track.
     * @default a random UUID
     */
    id?: string
}

/**
 * The events of a {@link MediaTrack}, with the arguments of their listeners.
 */
export type MediaTrackEvents = {
    /**
     * A packet received from the other peer (a received track).
     */
    rtp: [packet: RtpPacket]
    /**
     * A peer the track is sent to asks for a key frame: the encoder writing to the track should make one (a received
     * track sent on, to another connection, asks its own sender itself).
     */
    keyframerequest: []
    /**
     * The track ended: stopped, or its connection closed.
     */
    ended: []
}

/**
 * The tracks of the tracks of the engine
 */
const tracks: WeakMap<MediaStreamTrack, MediaTrack> = new WeakMap()

/**
 * The tracks of the engine of the tracks
 */
const engineTracks: WeakMap<MediaTrack, MediaStreamTrack> = new WeakMap()

/**
 * The events of the tracks
 */
const emitters: WeakMap<MediaTrack, EventEmitter> = new WeakMap()

/**
 * The receivers of the received tracks
 */
const receivers: WeakMap<MediaTrack, RTCRtpReceiver> = new WeakMap()

/**
 * Where the key frame requests of the received tracks whose packets come from elsewhere go
 */
const keyFrameRequesters: WeakMap<MediaTrack, () => void> = new WeakMap()

/**
 * When the key frame requests of a received track were sent on last
 */
const keyFrameRequests: WeakMap<MediaTrack, number> = new WeakMap()

/**
 * How often a received track asks its sender for a key frame at most, when the peers it is sent on to ask for some (ms)
 */
const KEY_FRAME_REQUEST_INTERVAL: number = 500

/**
 * The track of the engine being wrapped by the constructor
 */
let adopted: MediaStreamTrack | undefined

/**
 * An audio or video track of a {@link PeerConnection}: the RTP packets of encoded audio or video. Node.js captures and
 * encodes nothing: a track to send gets the packets of an encoder (ffmpeg, GStreamer sending RTP to a UDP port) with
 * `writeRtp()`, a received track gives the packets of the other peer (its `rtp` event), to record, to decode, or to send
 * on: a received track added to another connection forwards its packets there.
 *
 * Create one to send with `new MediaTrack(kind, options)`, and add it with `PeerConnection.addTrack()`; the received
 * ones come with the `track` event of the connection. Its events are in the Node.js style (`on`).
 * @example
 * ```typescript
 * import {createSocket, type Socket} from 'node:dgram'
 * import {MediaTrack, type PeerConnection} from '@lakutata/webrtc'
 *
 * declare const connection: PeerConnection
 * //ffmpeg -re -i camera.mp4 -an -c:v libx264 -profile:v baseline -pix_fmt yuv420p -tune zerolatency -g 30
 * //       -bsf:v dump_extra=freq=keyframe -f rtp rtp://127.0.0.1:5004
 * const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
 * connection.addTrack(video, 'camera')
 * const socket: Socket = createSocket('udp4')
 * socket.on('message', (datagram: Buffer): void => video.writeRtp(datagram))
 * socket.bind(5004)
 * ```
 */
export class MediaTrack {

    readonly #track: MediaStreamTrack

    readonly #id: string

    readonly #events: EventEmitter = new EventEmitter()

    #unsubscribe?: () => void

    /**
     * Create a track to send.
     * @param kind `audio` or `video`.
     * @param options The codec of the packets written, the id.
     */
    constructor(kind: MediaKind, options: MediaTrackOptions = {}) {
        const track: MediaStreamTrack = adopted ?? new MediaStreamTrack({kind: kind, codec: options.codec ? engineCodecOf(options.codec) : undefined})
        if (options.codec && !track.codec?.mimeType.toLowerCase().startsWith(`${kind}/`)) throw new TypeError(`The codec ${options.codec} is not one of ${kind}`)
        this.#track = track
        this.#id = options.id ?? track.id ?? track.uuid
        this.#events.setMaxListeners(0)
        tracks.set(track, this)
        engineTracks.set(this, track)
        emitters.set(this, this.#events)
        track.on('ended', (): void => void this.#events.emit('ended'))
        //The packets are read (and wrapped) only while the rtp event has listeners
        this.#events.on('newListener', (event: string): void => {
            if (event === 'rtp' && !this.#unsubscribe) this.#unsubscribe = this.#track.onReceiveRtp.subscribe((packet: EngineRtpPacket, _extensions?: Extensions): void => {
                if (this.#track.remote) this.#events.emit('rtp', rtpPacketOf(packet))
            }).unSubscribe
        })
        this.#events.on('removeListener', (event: string): void => {
            if (event === 'rtp' && !this.#events.listenerCount('rtp')) {
                this.#unsubscribe?.()
                this.#unsubscribe = undefined
            }
        })
    }

    /**
     * The id of the track.
     */
    public get id(): string {
        return this.#id
    }

    /**
     * `audio` or `video`.
     */
    public get kind(): MediaKind {
        return this.#track.kind as MediaKind
    }

    /**
     * Whether the track was received from the other peer.
     */
    public get remote(): boolean {
        return this.#track.remote
    }

    /**
     * `live`, or `ended` once stopped.
     */
    public get readyState(): 'live' | 'ended' {
        return this.#track.readyState
    }

    /**
     * The MIME type of the codec of the packets: the one negotiated, the one given to a track to send; `undefined` until
     * known.
     */
    public get codec(): string | undefined {
        const mimeType: string | undefined = this.#track.codec?.mimeType
        return mimeType ? canonicalCodec(mimeType) : undefined
    }

    /**
     * Send a packet to the peers the track is added to. The synchronization source and the payload type are the ones of
     * each connection, the sequence numbers and the timestamps go on from the ones written before.
     * @param packet A packet, or the bytes of one.
     * @throws {Error} When the track was received (it is not sent from here).
     * @example
     * ```typescript
     * import {MediaTrack, RtpPacket} from '@lakutata/webrtc'
     *
     * declare const opusFrame: Buffer
     * const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
     * audio.writeRtp(new RtpPacket({payloadType: 111, sequenceNumber: 1, timestamp: 960, payload: opusFrame}))
     * ```
     */
    public writeRtp(packet: RtpPacket | Uint8Array): void {
        if (packet instanceof RtpPacket) {
            this.#track.writeRtp(enginePacketOf(packet))
        } else {
            this.#track.writeRtp(Buffer.isBuffer(packet) ? packet : Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength))
        }
    }

    /**
     * Ask the other peer for a key frame (a picture loss indication), for the packets of a received video track to be
     * decodable from now on: when they start to be recorded or decoded. Nothing is sent for a track to send.
     * @example
     * ```typescript
     * import type {MediaTrack} from '@lakutata/webrtc'
     *
     * declare const received: MediaTrack
     * //The recording starts: from a key frame
     * received.requestKeyFrame()
     * ```
     */
    public requestKeyFrame(): void {
        const requester: (() => void) | undefined = keyFrameRequesters.get(this)
        if (requester) return requester()
        const receiver: RTCRtpReceiver | undefined = receivers.get(this)
        const ssrc: number | undefined = this.#track.ssrc
        if (receiver && ssrc !== undefined) void receiver.sendRtcpPLI(ssrc)
    }

    /**
     * Stop the track: it is sent no more, and receives no more.
     * @example
     * ```typescript
     * import type {MediaTrack} from '@lakutata/webrtc'
     *
     * declare const video: MediaTrack
     * video.stop()
     * ```
     */
    public stop(): void {
        this.#track.stop()
    }

    /**
     * Add a listener of an event.
     * @param event The event.
     * @param listener The listener.
     * @returns The track.
     * @example
     * ```typescript
     * import type {MediaTrack, RtpPacket} from '@lakutata/webrtc'
     *
     * declare const received: MediaTrack
     * received.on('rtp', (packet: RtpPacket): void => console.log(packet.sequenceNumber, packet.payload.length))
     * ```
     */
    public on<Event extends keyof MediaTrackEvents>(event: Event, listener: (...args: MediaTrackEvents[Event]) => void): this {
        this.#events.on(event, listener as (...args: unknown[]) => void)
        return this
    }

    /**
     * Add a listener of the next emission of an event.
     * @param event The event.
     * @param listener The listener.
     * @returns The track.
     * @example
     * ```typescript
     * import type {MediaTrack} from '@lakutata/webrtc'
     *
     * declare const received: MediaTrack
     * received.once('ended', (): void => console.log('the track ended'))
     * ```
     */
    public once<Event extends keyof MediaTrackEvents>(event: Event, listener: (...args: MediaTrackEvents[Event]) => void): this {
        this.#events.once(event, listener as (...args: unknown[]) => void)
        return this
    }

    /**
     * Remove a listener added with `on` or `once`.
     * @param event The event.
     * @param listener The listener.
     * @returns The track.
     * @example
     * ```typescript
     * import type {MediaTrack, RtpPacket} from '@lakutata/webrtc'
     *
     * declare const received: MediaTrack
     * const listener = (packet: RtpPacket): void => console.log(packet.timestamp)
     * received.on('rtp', listener)
     * received.off('rtp', listener)
     * ```
     */
    public off<Event extends keyof MediaTrackEvents>(event: Event, listener: (...args: MediaTrackEvents[Event]) => void): this {
        this.#events.off(event, listener as (...args: unknown[]) => void)
        return this
    }
}

/**
 * The track of a track of the engine, created once
 * @param track
 * @param receiver The receiver of a received track
 */
export function trackOf(track: MediaStreamTrack, receiver?: RTCRtpReceiver): MediaTrack {
    let wrapped: MediaTrack | undefined = tracks.get(track)
    if (!wrapped) {
        adopted = track
        try {
            wrapped = new MediaTrack(track.kind as MediaKind)
        } finally {
            adopted = undefined
        }
    }
    if (receiver) receivers.set(wrapped, receiver)
    return wrapped
}

/**
 * The track of the engine of a track
 * @param track
 */
export function engineTrackOf(track: MediaTrack): MediaStreamTrack {
    return engineTracks.get(track)!
}

/**
 * A peer the track is sent to asks for a key frame: a received track asks its own sender (at most every
 * KEY_FRAME_REQUEST_INTERVAL)
 * @param track
 */
export function keyFrameRequested(track: MediaTrack): void {
    emitters.get(track)!.emit('keyframerequest')
    if (!track.remote) return
    const now: number = Date.now()
    if (now - (keyFrameRequests.get(track) ?? 0) < KEY_FRAME_REQUEST_INTERVAL) return
    keyFrameRequests.set(track, now)
    track.requestKeyFrame()
}

/**
 * A received track whose packets come from elsewhere (a track of a room of the media server forwarded in a worker
 * thread): it is read and sent on like the others, its key frame requests go back where its packets come from, which is
 * told whether they are wanted (read, or sent on) as this changes
 * @param kind
 * @param codec The codec of its packets.
 * @param id The id of the track where the packets come from (a random one without it).
 * @param source Asks for a key frame; is told whether the packets are wanted.
 */
export function relayedTrack(kind: MediaKind, codec: RTCRtpCodecParameters, id: string | undefined, source: {requestKeyFrame(): void, wanted(wanted: boolean): void}): {track: MediaTrack, receive(packet: EngineRtpPacket, extensions?: Extensions): void} {
    const engine: MediaStreamTrack = new MediaStreamTrack({kind: kind, codec: codec, remote: true, ...id === undefined ? {} : {id: id}})
    const track: MediaTrack = trackOf(engine)
    keyFrameRequesters.set(track, source.requestKeyFrame)
    //The engine track reads its own packets: the others read them for something
    const own: number = engine.onReceiveRtp.length
    let wanted: boolean = false
    engine.onReceiveRtp.onsubscriberschange = (): void => {
        const now: boolean = !engine.stopped && engine.onReceiveRtp.length > own
        if (now !== wanted) source.wanted(wanted = now)
    }
    return {
        track: track,
        receive: (packet: EngineRtpPacket, extensions?: Extensions): void => engine.onReceiveRtp.execute(packet, extensions)
    }
}
