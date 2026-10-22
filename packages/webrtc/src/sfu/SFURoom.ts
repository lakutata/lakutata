import type {RTCRtpTransceiver} from '../lib/peer/media/rtpTransceiver.js'
import type {RTCPeerConnection} from '../lib/peer/peerConnection.js'
import {engineConnectionOf} from '../peer/EngineConnection.js'
import type {MediaKind, MediaTrack} from '../peer/MediaTrack.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import type {PeerConnection, PeerTrackEvent} from '../peer/PeerConnection.js'
import type {RtpTransceiver} from '../peer/RtpTransceiver.js'
import {
    SignalingControlChannel,
    type SignalingControlMessage,
    SignalingEvent,
    type SignalingJoinResult,
    type SignalingPeer,
    type SignalingPeerEvent,
    type SignalingPeerLeftEvent,
    type SignalingSignalEvent,
    type SignalingStream
} from '../protocol/SignalingProtocol.js'
import {Peer, type PeerHost, type PeerSignal} from '../shared/Peer.js'
import type {Signaling} from '../signaling/Signaling.js'
import type {SFUTrack} from './SFU.js'

/**
 * What a room needs of its media server
 */
export interface SFUHost {
    //The id of the member of the server
    readonly id: string
    readonly signaling: Signaling
    //A connection to a member
    connect(): Promise<PeerConnection>
    //Whether a member receives a track
    select(subscriber: SignalingPeer, track: SFUTrack): boolean
    emit(event: string, ...args: unknown[]): unknown
    //The last member left
    emptied(room: SFURoom): void
}

/**
 * A track a member publishes
 */
interface Publication {
    readonly track: SFUTrack
    //The track received from the member
    readonly media: MediaTrack
    //Its transceiver on the connection of the member
    readonly transceiver: RtpTransceiver
    readonly publisher: Member
}

/**
 * A track a member receives
 */
interface Subscription {
    transceiver: RtpTransceiver
    //Whether its sending was negotiated (a key frame is asked for then)
    started: boolean
    paused: boolean
}

/**
 * A member of the room: its connection to the server, what it publishes and receives
 */
interface Member {
    readonly id: string
    readonly peer: Peer<PeerConnection>
    metadata: unknown
    session?: string
    readonly publications: Map<RtpTransceiver, Publication>
    readonly subscriptions: Map<Publication, Subscription>
    //The streams sent to it, by their id on its connection; the id of each stream of each member
    readonly streams: Map<string, SignalingStream>
    readonly streamIds: Map<string, string>
    //The transceivers the server created to send to it
    readonly transceivers: Set<RtpTransceiver>
    control?: PeerChannel
}

/**
 * The transceiver of the engine of a transceiver
 * @param connection
 * @param transceiver
 */
function engineTransceiverOf(connection: PeerConnection, transceiver: RtpTransceiver): RTCRtpTransceiver | undefined {
    const engine: RTCPeerConnection = engineConnectionOf(connection)
    return transceiver.mid === null ? undefined : engine.getTransceivers().find((each: RTCRtpTransceiver): boolean => each.mid === transceiver.mid)
}

/**
 * The part of a room on the media server: a connection to each member (the server never gives up its offers), the
 * tracks they publish, forwarded to the others the server selects for them
 */
export class SFURoom {

    readonly #host: SFUHost

    readonly #members: Map<string, Member> = new Map()

    readonly #publications: Set<Publication> = new Set()

    //The transports whose bandwidth is watched
    readonly #watched: WeakSet<object> = new WeakSet()

    #closed: boolean = false

    /**
     * The name of the room.
     */
    public readonly name: string

    /**
     * Resolves once the server is in the room.
     */
    public readonly ready: Promise<void>

    /**
     * Create the part of a room, and join it.
     * @param host The media server.
     * @param name The room.
     */
    constructor(host: SFUHost, name: string) {
        this.#host = host
        this.name = name
        this.ready = this.#join()
    }

    /**
     * Whether the room has no member left.
     */
    public get empty(): boolean {
        return !this.#members.size
    }

    /**
     * Whether the server left the room.
     */
    public get closed(): boolean {
        return this.#closed
    }

    /**
     * The ids of the members.
     */
    public get members(): string[] {
        return [...this.#members.keys()]
    }

    /**
     * The tracks published.
     */
    public get tracks(): SFUTrack[] {
        return [...this.#publications].map((publication: Publication): SFUTrack => publication.track)
    }

    /**
     * A track published, received from its member.
     * @param peerId The member.
     * @param trackId The id of the track.
     * @returns The track, or undefined when it is not published.
     */
    public track(peerId: string, trackId: string): MediaTrack | undefined {
        for (const publication of this.#publications) {
            if (publication.track.peerId === peerId && publication.track.id === trackId) return publication.media
        }
        return undefined
    }

    /**
     * Leave the room: the connections to the members are closed.
     * @returns Resolves once the signaling is told.
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        this.#closed = true
        for (const member of [...this.#members.values()]) this.#remove(member)
        await this.#host.signaling.leave(this.#host.id, this.name).catch((): void => undefined)
    }

    /**
     * Join the room, with the members already in it
     */
    async #join(): Promise<void> {
        const result: SignalingJoinResult = await this.#host.signaling.join(this.#host.id, this.name, {
            role: 'sfu',
            receive: (event: string, payload: unknown): void => this.#receive(event, payload)
        })
        for (const peer of result.peers) if (!peer.role) this.#add(peer.peerId, peer.metadata, peer.session)
    }

    /**
     * An event of the room
     * @param event
     * @param payload
     */
    #receive(event: string, payload: unknown): void {
        if (this.#closed) return
        switch (event) {
            case SignalingEvent.peerJoined: {
                const joined: SignalingPeerEvent = payload as SignalingPeerEvent
                if (joined.role) return
                const member: Member | undefined = this.#members.get(joined.peerId)
                //A new client behind the same id: its old connection is useless
                if (member && joined.session !== undefined && member.session !== joined.session) this.#remove(member)
                if (member && this.#members.get(joined.peerId) === member) {
                    member.metadata = joined.metadata
                    return
                }
                this.#add(joined.peerId, joined.metadata, joined.session)
                return
            }
            case SignalingEvent.peerLeft: {
                const member: Member | undefined = this.#members.get((payload as SignalingPeerLeftEvent).peerId)
                if (member) this.#remove(member)
                return
            }
            case SignalingEvent.signal: {
                const signal: SignalingSignalEvent = payload as SignalingSignalEvent
                const member: Member = this.#members.get(signal.from) ?? this.#add(signal.from, undefined, signal.session)
                const received: PeerSignal = {}
                if (signal.description) received.description = signal.description
                if (signal.candidate) received.candidate = signal.candidate
                member.peer.receive(received)
                return
            }
        }
    }

    /**
     * Connect to a member, and send it the tracks published
     * @param id
     * @param metadata
     * @param session
     */
    #add(id: string, metadata: unknown, session: string | undefined): Member {
        const host: PeerHost<PeerConnection> = {
            localId: this.#host.id,
            create: (): Promise<PeerConnection> => this.#host.connect(),
            send: (to: string, signal: PeerSignal): Promise<void> => this.#signal(member, signal),
            signalingUp: true,
            closed: (): void => undefined,
            polite: false
        }
        const member: Member = {
            id: id,
            peer: new Peer<PeerConnection>(host, id, metadata, session),
            metadata: metadata,
            session: session,
            publications: new Map(),
            subscriptions: new Map(),
            streams: new Map(),
            streamIds: new Map(),
            transceivers: new Set()
        }
        this.#members.set(id, member)
        //A failed negotiation is the member's (it left meanwhile, it sent a wrong description)
        member.peer.on('error', (): void => undefined)
        member.peer.on('track', (event: PeerTrackEvent): void => this.#published(member, event))
        member.peer.ready.then((): void => {
            if (member.peer.closed) return
            const connection: PeerConnection = member.peer.connection
            //Once the negotiation applied the directions
            connection.on('signalingstatechange', (state: string): void => {
                if (state === 'stable') setImmediate((): void => this.#negotiated(member))
            })
            connection.on('connectionstatechange', (state: string): void => {
                if (state === 'connected') this.#watchBandwidth(member)
            })
            const control: PeerChannel = connection.createDataChannel(SignalingControlChannel.label, {negotiated: true, id: SignalingControlChannel.id})
            control.on('message', (data: string | Buffer | ArrayBuffer): void => this.#controlled(member, data))
            member.control = control
            for (const publication of this.#publications) this.#offer(member, publication)
        }, (): void => this.#remove(member))
        return member
    }

    /**
     * Close the connection to a member: its tracks are unpublished
     * @param member
     */
    #remove(member: Member): void {
        if (this.#members.get(member.id) === member) this.#members.delete(member.id)
        for (const publication of [...member.publications.values()]) this.#unpublished(publication)
        member.peer.close()
        if (!this.#closed && !this.#members.size) this.#host.emptied(this)
    }

    /**
     * Send a signal to a member: a description carries the streams sent to it
     * @param member
     * @param signal
     */
    async #signal(member: Member, signal: PeerSignal): Promise<void> {
        await this.#host.signaling.signal(this.#host.id, this.name, member.id, {
            ...signal,
            ...signal.description ? {streams: [...member.streams.values()]} : {}
        })
    }

    /**
     * Send a track published to a member, if the server selects it for the member
     * @param member
     * @param publication
     */
    #offer(member: Member, publication: Publication): void {
        if (member === publication.publisher || member.peer.closed) return
        const subscriber: SignalingPeer = {peerId: member.id, metadata: member.metadata, session: member.session}
        if (!this.#host.select(subscriber, publication.track)) return
        this.#subscribe(member, publication).catch((): void => undefined)
    }

    /**
     * A member publishes a track: the members selected for it receive it
     * @param member
     * @param event
     */
    #published(member: Member, event: PeerTrackEvent): void {
        //A transceiver of the member receiving again: the track it received before ended
        const previous: Publication | undefined = member.publications.get(event.transceiver)
        if (previous) this.#unpublished(previous)
        const engine: RTCRtpTransceiver | undefined = engineTransceiverOf(member.peer.connection, event.transceiver)
        const track: SFUTrack = {
            room: this.name,
            peerId: member.id,
            id: engine?.receiver.remoteTrackId ?? event.transceiver.mid ?? event.track.id,
            kind: event.track.kind as MediaKind,
            codec: event.track.codec ?? '',
            stream: event.streams[0]?.id ?? ''
        }
        const publication: Publication = {track: track, media: event.track, transceiver: event.transceiver, publisher: member}
        member.publications.set(event.transceiver, publication)
        this.#publications.add(publication)
        this.#host.emit('publish', track)
        for (const other of this.#members.values()) this.#offer(other, publication)
    }

    /**
     * A track is not published any more: the members receiving it stop
     * @param publication
     */
    #unpublished(publication: Publication): void {
        if (!this.#publications.delete(publication)) return
        if (publication.publisher.publications.get(publication.transceiver) === publication) publication.publisher.publications.delete(publication.transceiver)
        for (const member of this.#members.values()) this.#unsubscribe(member, publication)
        this.#host.emit('unpublish', publication.track)
    }

    /**
     * Send a track to a member: on a transceiver of a track sent before, of the same codec, else on a new one
     * @param member
     * @param publication
     */
    async #subscribe(member: Member, publication: Publication): Promise<void> {
        if (member.subscriptions.has(publication)) return
        const connection: PeerConnection = member.peer.connection
        const stream: string = this.#streamOf(member, publication.track)
        const taken: Set<RtpTransceiver> = new Set([...member.subscriptions.values()].map((subscription: Subscription): RtpTransceiver => subscription.transceiver))
        const reusable: RtpTransceiver | undefined = connection.getTransceivers().find((transceiver: RtpTransceiver): boolean => member.transceivers.has(transceiver)
            && !taken.has(transceiver)
            && !transceiver.sender.track
            && transceiver.direction === 'inactive'
            && transceiver.currentDirection === 'inactive'
            && transceiver.kind === publication.track.kind
            && engineTransceiverOf(connection, transceiver)?.sender.codec?.mimeType.toLowerCase() === publication.track.codec.toLowerCase())
        if (!reusable) {
            const transceiver: RtpTransceiver = connection.addTransceiver(publication.media, {direction: 'sendonly', streams: [stream]})
            member.transceivers.add(transceiver)
            member.subscriptions.set(publication, {transceiver: transceiver, started: false, paused: false})
            return
        }
        member.subscriptions.set(publication, {transceiver: reusable, started: false, paused: false})
        await reusable.sender.replaceTrack(publication.media)
        reusable.sender.setStreams(stream)
        reusable.direction = 'sendonly'
    }

    /**
     * Stop sending a track to a member: its transceiver stays, inactive, for the next one
     * @param member
     * @param publication
     */
    #unsubscribe(member: Member, publication: Publication): void {
        const subscription: Subscription | undefined = member.subscriptions.get(publication)
        if (!subscription) return
        member.subscriptions.delete(publication)
        if (member.peer.closed) return
        try {
            subscription.transceiver.direction = 'inactive'
            subscription.transceiver.sender.replaceTrack(null).catch((): void => undefined)
        } catch {
            //Stopped already
        }
    }

    /**
     * The id of the stream of a track on the connection of a member: short (at most 64 characters in an MSID), the
     * same for the tracks of a stream of a member
     * @param member
     * @param track
     */
    #streamOf(member: Member, track: SFUTrack): string {
        const key: string = JSON.stringify([track.peerId, track.stream || track.id])
        let id: string | undefined = member.streamIds.get(key)
        if (!id) {
            id = `s${member.streamIds.size + 1}`
            member.streamIds.set(key, id)
            member.streams.set(id, {id: id, peerId: track.peerId, stream: track.stream})
        }
        return id
    }

    /**
     * A negotiation with a member completed: the tracks it stopped sending are unpublished, the ones it refused (no
     * codec in common) are given up, and the ones it starts receiving begin with a key frame
     * @param member
     */
    #negotiated(member: Member): void {
        if (member.peer.closed || member.peer.connection.signalingState !== 'stable') return
        for (const publication of [...member.publications.values()]) {
            const direction: string | null = publication.transceiver.currentDirection
            if (direction === 'inactive' || direction === 'sendonly' || direction === 'stopped') this.#unpublished(publication)
        }
        for (const [publication, subscription] of [...member.subscriptions]) {
            const direction: string | null = subscription.transceiver.currentDirection
            if (direction === 'stopped') {
                member.subscriptions.delete(publication)
                this.#host.emit('unsupported', this.name, member.id, publication.track)
            } else if (!subscription.started && (direction === 'sendonly' || direction === 'sendrecv')) {
                subscription.started = true
                if (publication.track.kind === 'video') publication.media.requestKeyFrame()
            }
        }
    }

    /**
     * A message of a member on its control channel: pause or resume a track it receives
     * @param member
     * @param data
     */
    #controlled(member: Member, data: string | Buffer | ArrayBuffer): void {
        let message: SignalingControlMessage
        try {
            message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString())
        } catch {
            return
        }
        if (message?.type !== 'pause' && message?.type !== 'resume') return
        for (const [publication, subscription] of member.subscriptions) {
            if (subscription.transceiver.mid !== message.mid) continue
            const paused: boolean = message.type === 'pause'
            if (subscription.paused === paused) return
            subscription.paused = paused
            subscription.transceiver.sender.replaceTrack(paused ? null : publication.media).catch((): void => undefined)
            if (!paused && publication.track.kind === 'video') publication.media.requestKeyFrame()
            return
        }
    }

    /**
     * Tell the application when the bandwidth to a member is too low, and when it is enough again
     * @param member
     */
    #watchBandwidth(member: Member): void {
        const transport = engineConnectionOf(member.peer.connection).dtlsTransports[0]
        if (!transport || this.#watched.has(transport)) return
        this.#watched.add(transport)
        transport.senderBWE.onCongestion.subscribe((congested: boolean): void => {
            if (!member.peer.closed) this.#host.emit('congestion', this.name, member.id, congested, transport.senderBWE.availableBitrate)
        })
    }
}
