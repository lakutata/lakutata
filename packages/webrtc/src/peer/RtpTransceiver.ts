import type {RTCRtpReceiver} from '../lib/peer/media/rtpReceiver.js'
import type {RTCRtpSender} from '../lib/peer/media/rtpSender.js'
import type {MediaDirection, RTCRtpTransceiver} from '../lib/peer/media/rtpTransceiver.js'
import {MediaStream} from '../lib/peer/media/track.js'
import {type MediaKind, MediaTrack, engineTrackOf, trackOf} from './MediaTrack.js'

/**
 * The senders of the engine of the senders
 */
const engineSenders: WeakMap<RtpSender, RTCRtpSender> = new WeakMap()

/**
 * The direction of a {@link RtpTransceiver}: `sendrecv`, `sendonly`, `recvonly` or `inactive`.
 */
export type RtpTransceiverDirection = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive'

/**
 * The sending side of a {@link RtpTransceiver}, as `RTCRtpSender`: the track it sends.
 * @example
 * ```typescript
 * import {MediaTrack, type PeerConnection, type RtpSender} from '@lakutata/webrtc'
 *
 * declare const connection: PeerConnection
 * const sender: RtpSender = connection.addTrack(new MediaTrack('audio', {codec: 'audio/opus'}))
 * //Send another source, without negotiating again
 * await sender.replaceTrack(new MediaTrack('audio', {codec: 'audio/opus'}))
 * ```
 */
export class RtpSender {

    readonly #sender: RTCRtpSender

    /**
     * Wrap a sender of the engine
     * @param sender
     * @internal
     */
    constructor(sender: RTCRtpSender) {
        this.#sender = sender
        engineSenders.set(this, sender)
    }

    /**
     * The track sent; `null` when none.
     */
    public get track(): MediaTrack | null {
        return this.#sender.track ? trackOf(this.#sender.track) : null
    }

    /**
     * Send another track, of any codec negotiated (the other peer accepts each of them), without negotiating again;
     * `null` stops sending.
     * @param track The track, or `null`.
     * @returns Resolves once replaced.
     * @throws {DOMException} When the codec of the track is none of the ones negotiated (`InvalidModificationError`).
     * @example
     * ```typescript
     * import type {MediaTrack, RtpSender} from '@lakutata/webrtc'
     *
     * declare const sender: RtpSender
     * declare const backup: MediaTrack
     * await sender.replaceTrack(backup)
     * ```
     */
    public async replaceTrack(track: MediaTrack | null): Promise<void> {
        await this.#sender.replaceTrack(track ? engineTrackOf(track) : null)
    }

    /**
     * Change the streams the track sent belongs to, as `RTCRtpSender.setStreams()`: the other peer groups the tracks of
     * a stream. A new negotiation is needed.
     * @param streamIds The ids of the streams.
     * @example
     * ```typescript
     * import type {RtpSender} from '@lakutata/webrtc'
     *
     * declare const sender: RtpSender
     * sender.setStreams('screen')
     * ```
     */
    public setStreams(...streamIds: string[]): void {
        this.#sender.setStreams(streamIds.map((id: string): MediaStream => new MediaStream({id: id})))
    }
}

/**
 * The receiving side of a {@link RtpTransceiver}, as `RTCRtpReceiver`: the track it receives.
 * @example
 * ```typescript
 * import type {MediaTrack, PeerConnection, RtpReceiver} from '@lakutata/webrtc'
 *
 * declare const connection: PeerConnection
 * const tracks: MediaTrack[] = connection.getReceivers().map((receiver: RtpReceiver): MediaTrack => receiver.track)
 * ```
 */
export class RtpReceiver {

    readonly #receiver: RTCRtpReceiver

    /**
     * Wrap a receiver of the engine
     * @param receiver
     * @internal
     */
    constructor(receiver: RTCRtpReceiver) {
        this.#receiver = receiver
    }

    /**
     * The track received.
     */
    public get track(): MediaTrack {
        return trackOf(this.#receiver.track, this.#receiver)
    }
}

/**
 * The senders, receivers and transceivers of the ones of the engine
 */
const senders: WeakMap<RTCRtpSender, RtpSender> = new WeakMap()
const receivers: WeakMap<RTCRtpReceiver, RtpReceiver> = new WeakMap()
const transceivers: WeakMap<RTCRtpTransceiver, RtpTransceiver> = new WeakMap()

/**
 * An audio or video line of a {@link PeerConnection}, as `RTCRtpTransceiver`: a sender and a receiver, and the
 * direction the media goes. `addTrack()` creates one (or reuses one the other peer offered), `addTransceiver()` creates
 * one of a given direction: `recvonly` to receive without sending.
 * @example
 * ```typescript
 * import type {PeerConnection, RtpTransceiver} from '@lakutata/webrtc'
 *
 * declare const connection: PeerConnection
 * //Receive the video of the other peer, send none
 * const transceiver: RtpTransceiver = connection.addTransceiver('video', {direction: 'recvonly'})
 * ```
 */
export class RtpTransceiver {

    readonly #transceiver: RTCRtpTransceiver

    /**
     * Wrap a transceiver of the engine
     * @param transceiver
     * @internal
     */
    constructor(transceiver: RTCRtpTransceiver) {
        this.#transceiver = transceiver
    }

    /**
     * The media id of its line in the description; `null` until negotiated.
     */
    public get mid(): string | null {
        return this.#transceiver.mid
    }

    /**
     * `audio` or `video`.
     */
    public get kind(): MediaKind {
        return this.#transceiver.kind as MediaKind
    }

    /**
     * The direction wanted; changing it makes the connection negotiate.
     */
    public get direction(): RtpTransceiverDirection {
        return this.#transceiver.direction
    }

    /**
     * Change the direction wanted.
     * @param direction The direction.
     */
    public set direction(direction: RtpTransceiverDirection) {
        this.#transceiver.direction = direction as MediaDirection
    }

    /**
     * The direction negotiated, `stopped` once stopped; `null` until negotiated.
     */
    public get currentDirection(): RtpTransceiverDirection | 'stopped' | null {
        return this.#transceiver.currentDirection
    }

    /**
     * The sending side.
     */
    public get sender(): RtpSender {
        return senderOf(this.#transceiver.sender)
    }

    /**
     * The receiving side.
     */
    public get receiver(): RtpReceiver {
        return receiverOf(this.#transceiver.receiver)
    }

    /**
     * Stop the transceiver: it sends and receives no more, and the connection negotiates.
     * @example
     * ```typescript
     * import type {RtpTransceiver} from '@lakutata/webrtc'
     *
     * declare const transceiver: RtpTransceiver
     * transceiver.stop()
     * ```
     */
    public stop(): void {
        this.#transceiver.stop()
    }
}

/**
 * The sender of a sender of the engine, created once
 * @param sender
 */
export function senderOf(sender: RTCRtpSender): RtpSender {
    let wrapped: RtpSender | undefined = senders.get(sender)
    if (!wrapped) {
        wrapped = new RtpSender(sender)
        senders.set(sender, wrapped)
    }
    return wrapped
}

/**
 * The sender of the engine of a sender
 * @param sender
 */
export function engineSenderOf(sender: RtpSender): RTCRtpSender {
    return engineSenders.get(sender)!
}

/**
 * The receiver of a receiver of the engine, created once
 * @param receiver
 */
export function receiverOf(receiver: RTCRtpReceiver): RtpReceiver {
    let wrapped: RtpReceiver | undefined = receivers.get(receiver)
    if (!wrapped) {
        wrapped = new RtpReceiver(receiver)
        receivers.set(receiver, wrapped)
    }
    return wrapped
}

/**
 * The transceiver of a transceiver of the engine, created once
 * @param transceiver
 */
export function transceiverOf(transceiver: RTCRtpTransceiver): RtpTransceiver {
    let wrapped: RtpTransceiver | undefined = transceivers.get(transceiver)
    if (!wrapped) {
        wrapped = new RtpTransceiver(transceiver)
        transceivers.set(transceiver, wrapped)
    }
    return wrapped
}
