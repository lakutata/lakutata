import type {RTCRtpTransceiver} from '../lib/peer/media/rtpTransceiver.js'
import type {RTCPeerConnection} from '../lib/peer/peerConnection.js'
import type {RTCSctpTransport} from '../lib/peer/transport/sctp.js'
import {engineChannelOf, engineConnectionOf} from '../peer/EngineConnection.js'
import type {MediaKind, MediaTrack} from '../peer/MediaTrack.js'
import {type EndpointLeg, gathered, patchConnection} from '../peer/Endpoints.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import type {PeerConnection, PeerTrackEvent} from '../peer/PeerConnection.js'
import type {RtpTransceiver} from '../peer/RtpTransceiver.js'
import {
    type SignalingCandidate,
    SignalingControlChannel,
    type SignalingControlMessage,
    type SignalingDescription,
    SignalingEvent,
    type SignalingJoinResult,
    type SignalingPeer,
    type SignalingPeerEvent,
    type SignalingPeerLeftEvent,
    type SignalingRole,
    type SignalingSignalEvent,
    type SignalingStream
} from '../protocol/SignalingProtocol.js'
import {Peer, type PeerHost, type PeerSignal} from '../shared/Peer.js'
import type {SignalingReceiver} from '../signaling/Signaling.js'
import type {SFUTrack} from './SFU.js'

/**
 * What a room needs of the signaling (the Signaling component, or its proxy in a worker thread)
 */
export interface SFUSignaling {
    join(peerId: string, room: string, options: {role: SignalingRole, receive: SignalingReceiver}): Promise<SignalingJoinResult>
    leave(peerId: string, room: string): Promise<void>
    signal(peerId: string, room: string, to: string, signal: {description?: SignalingDescription, candidate?: SignalingCandidate | null, streams?: SignalingStream[]}): Promise<boolean>
}

/**
 * What a room needs of its media server
 */
export interface SFUHost {
    //The id of the member of the server
    readonly id: string
    readonly signaling: SFUSignaling
    //A connection to a member
    connect(): Promise<PeerConnection>
    //Whether a member receives a track
    select(subscriber: SignalingPeer, track: SFUTrack): boolean | Promise<boolean>
    emit(event: string, ...args: unknown[]): unknown
    //The last member left
    emptied(room: SFURoom): void
    //The members or the number of the viewers changed
    changed?(room: SFURoom): void
    //The source of a viewer changed
    sourced?(viewerId: string, source: string | undefined): void
}

/**
 * Chooses the member a viewer of WHEP receives, among the tracks published (see WHEPSelect)
 */
export type SFUViewerSelect = (tracks: SFUTrack[]) => string | undefined | Promise<string | undefined>

/**
 * A room of the media server, wherever it forwards (in the main thread, an SFURoom, or in a worker thread)
 */
export interface SFUServedRoom {
    readonly name: string
    readonly ready: Promise<void>
    readonly closed: boolean
    readonly members: string[]
    readonly tracks: SFUTrack[]
    readonly viewers: number
    track(peerId: string, trackId: string): MediaTrack | undefined
    publish(id: string, offer: SignalingDescription): Promise<EndpointLeg>
    play(id: string, offer: SignalingDescription, select?: SFUViewerSelect): Promise<EndpointLeg & {source(): string | undefined}>
    close(): Promise<void>
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
 * The connection of a member, and its state: a Peer of a client is one
 */
interface Leg {
    readonly connection: PeerConnection
    readonly ready: Promise<void>
    readonly closed: boolean
    close(): void
}

/**
 * A member of the room: its connection to the server, what it publishes and receives
 */
interface Member {
    readonly id: string
    //Its connection: the one negotiated by its Peer for a client, the one answering its offer for a stream published
    //with WHIP (which receives nothing, and is not negotiated again)
    readonly leg: Leg
    readonly peer?: Peer<PeerConnection>
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
 * The bytes a channel relayed to a member may have waiting to be sent: past them, the messages wait at the server, out
 * of the receive window of the member sending them (which waits then), until the channel sends half of them
 */
const RELAY_HIGH_WATER_MARK: number = 1024 * 1024

/**
 * Relay the messages of a channel to another one, as fast as the other one sends them: the messages of a reliable
 * channel wait at the server while the other one is not open or has too much to send, held out of the receive window
 * of the connection they come from (its sender waits once the window is closed); the ones of an unreliable channel are
 * dropped then, once the other one is open or past RELAY_HIGH_WATER_MARK waiting
 * @param source
 * @param target
 * @param early The messages the source got before.
 */
function relay(source: PeerChannel, target: PeerChannel, early: (string | Buffer | ArrayBuffer)[] = []): void {
    const transport: RTCSctpTransport = engineChannelOf(source).sctp
    const reliable: boolean = source.maxRetransmits === null && source.maxPacketLifeTime === null
    const waiting: {data: string | Buffer, size: number}[] = []
    let held: number = 0
    let queued: number = 0
    target.bufferedAmountLowThreshold = RELAY_HIGH_WATER_MARK / 2
    const drain = (): void => {
        while (waiting.length && target.readyState === 'open' && target.bufferedAmount < RELAY_HIGH_WATER_MARK) {
            const {data, size} = waiting.shift()!
            queued -= size
            target.send(data)
            if (reliable) {
                held -= size
                transport.releaseReceived(size)
            }
        }
    }
    const relayed = (data: string | Buffer | ArrayBuffer): void => {
        const message: string | Buffer = typeof data === 'string' || Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (target.readyState === 'closing' || target.readyState === 'closed') return
        if (!waiting.length && target.readyState === 'open' && target.bufferedAmount < RELAY_HIGH_WATER_MARK) return target.send(message)
        const size: number = typeof message === 'string' ? Buffer.byteLength(message) : message.length
        if (!reliable && (target.readyState === 'open' || queued + size > RELAY_HIGH_WATER_MARK)) return
        waiting.push({data: message, size: size})
        queued += size
        if (reliable) {
            held += size
            transport.holdReceived(size)
        }
    }
    early.forEach(relayed)
    source.on('message', relayed)
    target.on('open', drain)
    target.on('bufferedamountlow', drain)
    //The window held is given back when the other side is gone
    target.on('close', (): void => {
        waiting.length = 0
        queued = 0
        if (held) transport.releaseReceived(held)
        held = 0
    })
}

/**
 * A viewer of WHEP: its connection sends it the audio and the video of a member of the room, its source
 */
interface Viewer {
    readonly id: string
    readonly leg: Leg
    //The transceiver sending each kind, and the track it sends
    readonly transceivers: Map<MediaKind, RtpTransceiver>
    readonly attached: Map<MediaKind, Publication>
    //Chooses the member it receives: none for the default one
    readonly select?: SFUViewerSelect
    source?: string
    //The changes of its tracks, one after the other
    feeding: Promise<void>
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
export class SFURoom implements SFUServedRoom {

    readonly #host: SFUHost

    readonly #members: Map<string, Member> = new Map()

    readonly #viewers: Map<string, Viewer> = new Map()

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
     * Whether the room has no member and no viewer left.
     */
    public get empty(): boolean {
        return !this.#members.size && !this.#viewers.size
    }

    /**
     * The number of the viewers of WHEP.
     */
    public get viewers(): number {
        return this.#viewers.size
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
        for (const viewer of [...this.#viewers.values()]) this.#stop(viewer)
        await this.#host.signaling.leave(this.#host.id, this.name).catch((): void => undefined)
    }

    /**
     * A viewer of WHEP: the connection answering its offer sends it an audio and a video track of a member of the room
     * (its source), once and as long as there is one, from a key frame. Its media negotiate every codec it offers that
     * the server has, so a source publishing later with any of them is sent too.
     * @param id The id of the viewer.
     * @param offer The offer of the viewer.
     * @param select Chooses its source among the members publishing; the newest stream of WHIP, else the first member
     * publishing, without it.
     * @returns The connection, its answer with all its candidates, and its source now.
     */
    public async play(id: string, offer: SignalingDescription, select?: SFUViewerSelect): Promise<EndpointLeg & {source(): string | undefined}> {
        const connection: PeerConnection = await this.#host.connect()
        const ended: (() => void)[] = []
        let closed: boolean = false
        const leg: Leg = {
            connection: connection,
            ready: Promise.resolve(),
            get closed(): boolean {
                return closed
            },
            close: (): void => {
                if (closed) return
                closed = true
                connection.close()
                for (const listener of ended.splice(0)) listener()
            }
        }
        const viewer: Viewer = {id: id, leg: leg, transceivers: new Map(), attached: new Map(), select: select, feeding: Promise.resolve()}
        connection.on('connectionstatechange', (state: string): void => {
            if (state === 'failed' || state === 'closed') this.#stop(viewer)
        })
        try {
            await connection.setRemoteDescription(offer)
            //The first media of each kind sends; no track before the answer, which keeps all the codecs
            for (const transceiver of connection.getTransceivers()) {
                if (viewer.transceivers.has(transceiver.kind)) continue
                viewer.transceivers.set(transceiver.kind, transceiver)
                transceiver.direction = 'sendonly'
            }
            if (!viewer.transceivers.size) throw new Error('The offer has no audio and no video')
            await connection.setLocalDescription()
            await gathered(connection)
            if (closed) throw new Error(`The connection is ${connection.connectionState}`)
        } catch (error) {
            leg.close()
            throw error
        }
        this.#viewers.set(id, viewer)
        this.#host.changed?.(this)
        await this.#feed(viewer)
        return {
            answer: connection.localDescription!,
            patch: (fragment: string, restart: boolean): Promise<string | undefined | null> => patchConnection(connection, fragment, restart),
            ended: (listener: () => void): unknown => closed ? listener() : ended.push(listener),
            close: (): void => this.#stop(viewer),
            source: (): string | undefined => viewer.source
        }
    }

    /**
     * Send a viewer the tracks of its source, after the changes before
     * @param viewer
     */
    #feed(viewer: Viewer): Promise<void> {
        viewer.feeding = viewer.feeding.then((): Promise<void> => this.#refeed(viewer)).catch((): void => undefined)
        return viewer.feeding
    }

    /**
     * Send a viewer the tracks of its source: chosen again, as the tracks of the room change
     * @param viewer
     */
    async #refeed(viewer: Viewer): Promise<void> {
        if (viewer.leg.closed) return
        const selected: string | undefined = viewer.select ? await viewer.select(this.tracks) : undefined
        if (viewer.leg.closed) return
        const publishing: Member[] = [...this.#members.values()].filter((member: Member): boolean => member.publications.size > 0)
        const chosen: string | undefined = selected
            ?? publishing.filter((member: Member): boolean => !member.peer).at(-1)?.id
            ?? publishing[0]?.id
        const source: Member | undefined = chosen === undefined ? undefined : this.#members.get(chosen)
        const before: string | undefined = viewer.source
        viewer.source = source?.publications.size ? source.id : undefined
        if (viewer.source !== before) this.#host.sourced?.(viewer.id, viewer.source)
        for (const [kind, transceiver] of viewer.transceivers) {
            const publication: Publication | undefined = viewer.source === undefined
                ? undefined
                : [...source!.publications.values()].find((each: Publication): boolean => each.track.kind === kind)
            if (viewer.attached.get(kind) === publication) continue
            viewer.attached.delete(kind)
            try {
                await transceiver.sender.replaceTrack(publication?.media ?? null)
            } catch {
                //Of a codec the viewer does not have
                this.#host.emit('unsupported', this.name, viewer.id, publication!.track)
                await transceiver.sender.replaceTrack(null).catch((): void => undefined)
                continue
            }
            if (!publication) continue
            viewer.attached.set(kind, publication)
            if (kind === 'video') publication.media.requestKeyFrame()
        }
    }

    /**
     * A viewer stopped: its connection is closed
     * @param viewer
     */
    #stop(viewer: Viewer): void {
        if (this.#viewers.get(viewer.id) !== viewer) return viewer.leg.close()
        this.#viewers.delete(viewer.id)
        viewer.leg.close()
        if (!this.#closed) this.#host.changed?.(this)
        if (!this.#closed && this.empty) this.#host.emptied(this)
    }

    /**
     * A stream published with WHIP joins the room: a member (of role `whip`) whose connection answers the offer of the
     * publisher, publishing its tracks and receiving nothing
     * @param id The id of the member.
     * @param offer The offer of the publisher.
     * @returns The connection, its answer with all its candidates.
     */
    public async publish(id: string, offer: SignalingDescription): Promise<EndpointLeg> {
        const connection: PeerConnection = await this.#host.connect()
        const ended: (() => void)[] = []
        let closed: boolean = false
        const leg: Leg = {
            connection: connection,
            ready: Promise.resolve(),
            get closed(): boolean {
                return closed
            },
            close: (): void => {
                if (closed) return
                closed = true
                connection.close()
                for (const listener of ended.splice(0)) listener()
            }
        }
        const member: Member = {
            id: id,
            leg: leg,
            metadata: undefined,
            publications: new Map(),
            subscriptions: new Map(),
            streams: new Map(),
            streamIds: new Map(),
            transceivers: new Set()
        }
        this.#members.set(id, member)
        this.#host.changed?.(this)
        connection.addEventListener('track', (event: PeerTrackEvent): void => this.#published(member, event))
        connection.on('connectionstatechange', (state: string): void => {
            if (state === 'failed' || state === 'closed') this.#remove(member)
        })
        //Negotiated again for an ICE restart (a PATCH)
        connection.on('signalingstatechange', (state: string): void => {
            if (state === 'stable') setImmediate((): void => this.#negotiated(member))
        })
        try {
            await connection.setRemoteDescription(offer)
            await connection.setLocalDescription()
            await gathered(connection)
            if (closed) throw new Error(`The connection is ${connection.connectionState}`)
            await this.#host.signaling.join(id, this.name, {role: 'whip', receive: (): void => undefined})
        } catch (error) {
            this.#remove(member)
            throw error
        }
        return {
            answer: connection.localDescription!,
            patch: (fragment: string, restart: boolean): Promise<string | undefined | null> => patchConnection(connection, fragment, restart),
            ended: (listener: () => void): unknown => closed ? listener() : ended.push(listener),
            close: (): void => this.#remove(member)
        }
    }

    /**
     * Join the room, with the members already in it
     */
    async #join(): Promise<void> {
        const result: SignalingJoinResult = await this.#host.signaling.join(this.#host.id, this.name, {
            role: 'sfu',
            receive: (event: string, payload: unknown): void => this.#receive(event, payload)
        })
        for (const peer of result.peers) if (this.#serves(peer)) this.#add(peer.peerId, peer.metadata, peer.session)
    }

    /**
     * Whether the server serves a member: a client connected to it (the media server of another node serves the
     * others)
     * @param peer
     */
    #serves(peer: SignalingPeer): boolean {
        return !peer.role && peer.sfu === this.#host.id
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
                //Joined again through the media server of another node
                if (!this.#serves(joined)) {
                    if (member?.peer) this.#remove(member)
                    return
                }
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
                member.peer?.receive(received)
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
        const peer: Peer<PeerConnection> = new Peer<PeerConnection>(host, id, metadata, session)
        const member: Member = {
            id: id,
            leg: peer,
            peer: peer,
            metadata: metadata,
            session: session,
            publications: new Map(),
            subscriptions: new Map(),
            streams: new Map(),
            streamIds: new Map(),
            transceivers: new Set()
        }
        this.#members.set(id, member)
        this.#host.changed?.(this)
        //A failed negotiation is the member's (it left meanwhile, it sent a wrong description)
        peer.on('error', (): void => undefined)
        peer.on('track', (event: PeerTrackEvent): void => this.#published(member, event))
        peer.on('datachannel', (channel: PeerChannel): void => this.#opened(member, channel))
        peer.ready.then((): void => {
            if (peer.closed) return
            const connection: PeerConnection = peer.connection
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
     * A member opened a channel to another one (its protocol): the server opens the same channel to the other one (its
     * protocol the id of the first one), and relays their messages
     * @param member
     * @param channel
     */
    #opened(member: Member, channel: PeerChannel): void {
        const other: Member | undefined = this.#members.get(channel.protocol)
        //Not to a stream published with WHIP: it has no data channels
        if (!other || other === member || !other.peer || other.leg.closed) return channel.close()
        //Its first messages may come with its opening, before the other side is there
        const early: (string | Buffer | ArrayBuffer)[] = []
        const keep = (data: string | Buffer | ArrayBuffer): number => early.push(data)
        channel.on('message', keep)
        other.leg.ready.then((): void => {
            channel.off('message', keep)
            if (other.leg.closed || channel.readyState === 'closed') return channel.close()
            const relayed: PeerChannel = other.leg.connection.createDataChannel(channel.label, {
                protocol: member.id,
                ordered: channel.ordered,
                ...channel.maxRetransmits !== null ? {maxRetransmits: channel.maxRetransmits} : {},
                ...channel.maxPacketLifeTime !== null ? {maxPacketLifeTime: channel.maxPacketLifeTime} : {}
            })
            relay(channel, relayed, early)
            relay(relayed, channel)
            channel.on('close', (): void => relayed.close())
            relayed.on('close', (): void => channel.close())
        }, (): void => channel.close())
    }

    /**
     * Close the connection to a member: its tracks are unpublished
     * @param member
     */
    #remove(member: Member): void {
        if (this.#members.get(member.id) !== member) return
        this.#members.delete(member.id)
        for (const publication of [...member.publications.values()]) this.#unpublished(publication)
        member.leg.close()
        //A stream published with WHIP leaves the signaling (before the server, when it was the last one)
        if (!member.peer) this.#host.signaling.leave(member.id, this.name).catch((): void => undefined)
        if (!this.#closed) this.#host.changed?.(this)
        if (!this.#closed && this.empty) this.#host.emptied(this)
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
        //A stream published with WHIP receives nothing
        if (member === publication.publisher || !member.peer || member.leg.closed) return
        const subscriber: SignalingPeer = {peerId: member.id, metadata: member.metadata, session: member.session}
        const selected: boolean | Promise<boolean> = this.#host.select(subscriber, publication.track)
        if (typeof selected === 'boolean') {
            if (selected) this.#subscribe(member, publication).catch((): void => undefined)
            return
        }
        //Chosen elsewhere: the member and the track may be gone meanwhile
        selected.then((selected: boolean): Promise<void> | undefined => selected
            && this.#members.get(member.id) === member
            && !member.leg.closed
            && this.#publications.has(publication)
            ? this.#subscribe(member, publication)
            : undefined).catch((): void => undefined)
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
        const engine: RTCRtpTransceiver | undefined = engineTransceiverOf(member.leg.connection, event.transceiver)
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
        for (const viewer of this.#viewers.values()) void this.#feed(viewer)
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
        for (const viewer of this.#viewers.values()) void this.#feed(viewer)
    }

    /**
     * Send a track to a member: on a transceiver of a track sent before, of the same codec, else on a new one
     * @param member
     * @param publication
     */
    async #subscribe(member: Member, publication: Publication): Promise<void> {
        if (member.subscriptions.has(publication)) return
        const connection: PeerConnection = member.leg.connection
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
        if (member.leg.closed) return
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
        if (member.leg.closed || member.leg.connection.signalingState !== 'stable') return
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
        const transport = engineConnectionOf(member.leg.connection).dtlsTransports[0]
        if (!transport || this.#watched.has(transport)) return
        this.#watched.add(transport)
        transport.senderBWE.onCongestion.subscribe((congested: boolean): void => {
            if (!member.leg.closed) this.#host.emit('congestion', this.name, member.id, congested, transport.senderBWE.availableBitrate)
        })
    }
}
