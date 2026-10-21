import type {SignalingCandidate, SignalingDescription} from '../protocol/SignalingProtocol.js'
import type {ChannelOf, DataChannelOptions, PeerConnectionLike, TrackEventOf} from './Connections.js'
import {Emitter} from './Emitter.js'
import {unrefTimer} from './Transports.js'

/**
 * The events of a {@link Peer}.
 */
export type PeerEvents<Channel, TrackEvent = unknown> = {
    /**
     * A data channel the other member created.
     */
    datachannel: [channel: Channel]
    /**
     * An audio or video track of the other member: the `track` event of the connection (`event.track`,
     * `event.streams`).
     */
    track: [event: TrackEvent]
    /**
     * The state of the connection changed: `new`, `connecting`, `connected`, `disconnected`, `failed`, `closed`.
     */
    connectionstatechange: [state: string]
    /**
     * The other member joined the room again with new metadata.
     */
    metadata: [metadata: unknown]
    /**
     * The peer is closed: the other member left, its connection failed for good, or the room was left.
     */
    close: []
    /**
     * The negotiation failed.
     */
    error: [error: Error]
}

/**
 * A signal for the other member
 */
export type PeerSignal = {description?: SignalingDescription, candidate?: SignalingCandidate}

/**
 * What a peer needs of its room
 */
export interface PeerHost<Connection extends PeerConnectionLike<any>> {
    //The id of the local member
    readonly localId: string
    //Create the connection
    create(): Connection | Promise<Connection>
    //Send a signal to the member
    send(to: string, signal: PeerSignal): Promise<void>
    //Whether the signaling is up, to restart ICE
    readonly signalingUp: boolean
    //The peer is closed
    closed(peer: Peer<Connection>): void
}

/**
 * The remote candidates kept while their description has not arrived
 */
const MAX_PENDING_CANDIDATES: number = 200

/**
 * The ICE username fragments of a description
 * @param sdp
 */
function ufragsOf(sdp: string | undefined): Set<string> {
    return new Set([...(sdp ?? '').matchAll(/^a=ice-ufrag:(\S+)/gm)].map((match: RegExpMatchArray): string => match[1]))
}

/**
 * How long a connection may stay `disconnected` before ICE restarts, in milliseconds
 */
const DISCONNECTED_RESTART_DELAY: number = 5000

/**
 * Another member of a room, and the peer-to-peer connection to it: `connection` is a `RTCPeerConnection` in the
 * browsers and a `PeerConnection` in Node.js. The offers and the answers are exchanged through the signaling as the
 * W3C "perfect negotiation" does it, so both members may add channels (and tracks) at any time, at the same time too:
 * the member whose id comes first is the polite one, giving up its offer when both offer at once.
 *
 * The connection is set up when a data channel (or a track) is added on one side. It is repaired by itself: an ICE
 * restart when it fails or stays disconnected for 5 seconds, once the signaling is up. The peer stays when its member's
 * signaling is lost while their connection is up, and closes when the member leaves the room, when the connection
 * fails without the member in the room, and when the room is left.
 */
export class Peer<Connection extends PeerConnectionLike<any> = PeerConnectionLike> extends Emitter<PeerEvents<ChannelOf<Connection>, TrackEventOf<Connection>>> {

    /**
     * The other member's id.
     */
    public readonly id: string

    /**
     * Whether this side gives up its offer when both offer at once.
     */
    public readonly polite: boolean

    readonly #host: PeerHost<Connection>

    #metadata: unknown

    #session?: string

    #connection: Connection

    #queue: Promise<void>

    #makingOffer: boolean = false

    #ignoreOffer: boolean = false

    //The candidates received before the remote description they belong to (their ufrag), at most MAX_PENDING_CANDIDATES
    #candidates: SignalingCandidate[] = []

    //While a local description is being set and sent, the local candidates wait: the other side gets the description
    //first, so it knows the ufrag of the candidates (an ICE restart gathers new ones before the offer is sent)
    #describing: number = 0

    readonly #held: SignalingCandidate[] = []

    #closed: boolean = false

    #away: boolean = false

    #restartPending: boolean = false

    #restartTimer?: ReturnType<typeof setTimeout>

    /**
     * Create the peer of a member (by its room).
     * @param host The room.
     * @param id The member's id.
     * @param metadata The member's metadata.
     * @param session The member's session.
     */
    constructor(host: PeerHost<Connection>, id: string, metadata: unknown, session: string | undefined) {
        super()
        this.#host = host
        this.id = id
        this.#metadata = metadata
        this.#session = session
        this.polite = host.localId < id
        this.#queue = this.#open()
    }

    /**
     * The peer-to-peer connection to the member.
     */
    public get connection(): Connection {
        return this.#connection
    }

    /**
     * What the member gave when it joined.
     */
    public get metadata(): unknown {
        return this.#metadata
    }

    /**
     * The session of the member's client.
     */
    public get session(): string | undefined {
        return this.#session
    }

    /**
     * Whether the member is not in the room any more (its signaling was lost) while the connection is still up.
     */
    public get away(): boolean {
        return this.#away
    }

    /**
     * Whether the peer is closed.
     */
    public get closed(): boolean {
        return this.#closed
    }

    /**
     * Resolves once the connection is created (the room emits `peer` then).
     */
    public get ready(): Promise<void> {
        return this.#queue
    }

    /**
     * Create a data channel to the member; the connection is set up (or negotiated again) by itself.
     * @param label The label of the channel.
     * @param options Whether it is ordered, reliable, negotiated.
     * @returns The channel: an `RTCDataChannel` in the browsers, a `PeerChannel` in Node.js.
     */
    public createDataChannel(label: string, options?: DataChannelOptions): ChannelOf<Connection> {
        return this.#connection.createDataChannel(label, options) as ChannelOf<Connection>
    }

    /**
     * Restart ICE: new candidates are gathered and exchanged, for a connection whose network changed.
     */
    public restartIce(): void {
        if (this.#closed) return
        if (!this.#host.signalingUp) {
            this.#restartPending = true
            return
        }
        this.#restartPending = false
        this.#connection.restartIce()
    }

    /**
     * Close the connection to the member.
     */
    public close(): void {
        if (this.#closed) return
        this.#closed = true
        clearTimeout(this.#restartTimer)
        try {
            this.#connection?.close()
        } catch {
            //Closed already
        }
        this.emit('close')
        this.#host.closed(this)
    }

    /**
     * A signal from the member, handled after the ones before it
     * @param signal
     * @internal
     */
    public receive(signal: PeerSignal): void {
        this.#queue = this.#queue.then((): Promise<void> => this.#receive(signal)).catch((error: Error): void => this.#fail(error))
    }

    /**
     * The member joined again
     * @param metadata
     * @internal
     */
    public rejoined(metadata: unknown): void {
        this.#away = false
        this.#metadata = metadata
        this.emit('metadata', metadata)
    }

    /**
     * The member's signaling was lost; the peer stays while the connection is up
     * @internal
     */
    public left(): void {
        if (this.#connection?.connectionState === 'connected') {
            this.#away = true
        } else {
            this.close()
        }
    }

    /**
     * The signaling is up again: the ICE restart waiting for it
     * @internal
     */
    public resume(): void {
        if (this.#restartPending) this.restartIce()
    }

    /**
     * Create the connection and listen to it
     */
    async #open(): Promise<void> {
        const connection: Connection = await this.#host.create()
        this.#connection = connection
        if (this.#closed) {
            connection.close()
            return
        }
        connection.addEventListener('negotiationneeded', (): void => void this.#negotiate())
        connection.addEventListener('icecandidate', (event: {candidate?: {candidate?: string, toJSON?: () => SignalingCandidate} | null}): void => {
            const candidate: {candidate?: string, toJSON?: () => SignalingCandidate} | null | undefined = event.candidate
            //The end of the candidates is not sent: ICE completes without it
            if (!candidate?.candidate) return
            const init: SignalingCandidate = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate as SignalingCandidate
            const plain: SignalingCandidate = {candidate: init.candidate, sdpMid: init.sdpMid ?? null, sdpMLineIndex: init.sdpMLineIndex ?? null, usernameFragment: init.usernameFragment ?? null}
            if (this.#describing) {
                this.#held.push(plain)
            } else {
                void this.#send({candidate: plain})
            }
        })
        connection.addEventListener('connectionstatechange', (): void => this.#stateChanged())
        connection.addEventListener('datachannel', (event: {channel: ChannelOf<Connection>}): void => void this.emit('datachannel', event.channel))
        connection.addEventListener('track', (event: TrackEventOf<Connection>): void => void this.emit('track', event))
    }

    /**
     * Send a signal; a failure is an error of the peer
     * @param signal
     */
    #send(signal: PeerSignal): Promise<void> {
        return this.#host.send(this.id, signal).catch((error: Error): void => this.#fail(error))
    }

    /**
     * Set the local description the state calls for (an offer, an answer) and send it, then the candidates gathered
     * meanwhile
     */
    async #describe(): Promise<void> {
        this.#describing++
        try {
            await this.#connection.setLocalDescription()
            const description: SignalingDescription | null = this.#connection.localDescription
            if (description) await this.#send({description: {type: description.type, sdp: description.sdp}})
        } finally {
            this.#describing--
            if (!this.#describing) for (const candidate of this.#held.splice(0)) void this.#send({candidate: candidate})
        }
    }

    /**
     * Offer, as the negotiation needs it
     */
    async #negotiate(): Promise<void> {
        if (this.#closed) return
        try {
            this.#makingOffer = true
            await this.#describe()
        } catch (error) {
            this.#fail(error as Error)
        } finally {
            this.#makingOffer = false
        }
    }

    /**
     * Apply a signal (perfect negotiation)
     * @param signal
     */
    async #receive(signal: PeerSignal): Promise<void> {
        if (this.#closed) return
        const connection: Connection = this.#connection
        if (signal.description) {
            const description: SignalingDescription = signal.description
            const collision: boolean = description.type === 'offer' && (this.#makingOffer || connection.signalingState !== 'stable')
            this.#ignoreOffer = !this.polite && collision
            if (this.#ignoreOffer) return
            //The polite side's own offer is rolled back by setRemoteDescription itself
            await connection.setRemoteDescription(description)
            //The candidates received before it that belong to it
            const ufrags: Set<string> = ufragsOf(description.sdp)
            const pending: SignalingCandidate[] = this.#candidates
            this.#candidates = []
            for (const candidate of pending) {
                if (!candidate.usernameFragment || ufrags.has(candidate.usernameFragment)) {
                    await this.#addCandidate(candidate)
                } else {
                    this.#candidates.push(candidate)
                }
            }
            if (description.type === 'offer') await this.#describe()
        } else if (signal.candidate) {
            const remote: SignalingDescription | null | undefined = (connection as unknown as {remoteDescription?: SignalingDescription | null}).remoteDescription
            const ufrag: string | null | undefined = signal.candidate.usernameFragment
            //Before its description: an offer still on its way (the first one, an ICE restart)
            if (!remote || (ufrag && !ufragsOf(remote.sdp).has(ufrag))) {
                if (!this.#ignoreOffer) {
                    this.#candidates.push(signal.candidate)
                    if (this.#candidates.length > MAX_PENDING_CANDIDATES) this.#candidates.shift()
                }
                return
            }
            await this.#addCandidate(signal.candidate)
        }
    }

    /**
     * Add a remote candidate; the ones of an ignored offer may fail
     * @param candidate
     */
    async #addCandidate(candidate: SignalingCandidate): Promise<void> {
        try {
            await this.#connection.addIceCandidate(candidate)
        } catch (error) {
            if (!this.#ignoreOffer) throw error
        }
    }

    /**
     * The state of the connection changed
     */
    #stateChanged(): void {
        if (this.#closed) return
        const state: string = this.#connection.connectionState
        clearTimeout(this.#restartTimer)
        this.emit('connectionstatechange', state)
        if (state === 'failed') {
            this.#repair()
        } else if (state === 'disconnected') {
            this.#restartTimer = unrefTimer(setTimeout((): void => {
                if (this.#connection.connectionState === 'disconnected') this.#repair()
            }, DISCONNECTED_RESTART_DELAY))
        } else if (state === 'closed') {
            this.close()
        }
    }

    /**
     * Restart ICE, or close the peer when its member is not in the room
     */
    #repair(): void {
        if (this.#away) return this.close()
        this.restartIce()
    }

    /**
     * An error of the negotiation
     * @param error
     */
    #fail(error: Error): void {
        if (!this.#closed) this.emit('error', error)
    }
}
