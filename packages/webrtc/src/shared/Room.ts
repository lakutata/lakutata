import {
    SignalingControlChannel,
    type SignalingControlMessage,
    type SignalingPeer,
    type SignalingPeerEvent,
    type SignalingPeerLeftEvent,
    type SignalingSignalEvent,
    type SignalingStream
} from '../protocol/SignalingProtocol.js'
import type {ChannelOf, PeerConnectionConfiguration, PeerConnectionLike, StreamOf, TrackEventOf, TrackOf, TransceiverLike} from './Connections.js'
import {Emitter, type EmitterListener} from './Emitter.js'
import {Peer, type PeerHost, type PeerSignal} from './Peer.js'

/**
 * The events of a {@link Room}.
 */
export type RoomEvents<Connection extends PeerConnectionLike<any>> = {
    /**
     * A member to connect to: each member already in the room when it was joined, then each member joining it. A
     * listener added later is called at once for the peers already there.
     */
    peer: [peer: Peer<Connection>]
    /**
     * A peer was closed: its member left, or its connection was lost for good.
     */
    'peer-left': [peer: Peer<Connection>]
    /**
     * The room was left.
     */
    close: []
    /**
     * A peer could not be created, or a peer failed to negotiate.
     */
    error: [error: Error, peer?: Peer<Connection>]
}

/**
 * What a room needs of its signaling session
 */
export interface RoomHost<Connection extends PeerConnectionLike<any>> {
    readonly localId: string
    readonly signalingUp: boolean
    create(configuration?: PeerConnectionConfiguration): Connection | Promise<Connection>
    send(room: string, to: string, signal: PeerSignal): Promise<void>
    leave(room: Room<Connection>): Promise<void>
}

/**
 * The tracks and the channels kept at most while their member is not known
 */
const MAX_UNROUTED: number = 256

/**
 * A channel received through the media server not given to its peer yet, and the messages it got meanwhile
 */
interface UnroutedChannel<Channel> {
    readonly channel: Channel
    readonly early: unknown[]
    readonly keep: (event: {data: unknown}) => number
}

/**
 * A track published in the room, and its transceiver on each connection
 */
interface Publication<Connection extends PeerConnectionLike<any>> {
    readonly streams: StreamOf<Connection>[]
    readonly transceivers: Map<Connection, TransceiverLike>
}

/**
 * A room joined through the signaling: its {@link Peer}s, one for each other member. Listen to `peer` to use each of
 * them (create its data channels, listen to its channels and its tracks), to `peer-left` for the ones closed; publish
 * the tracks sent to every member with `publish()`.
 *
 * The members are connected peer to peer, or, in a room with a media server (its `sfu`), each member to the server
 * only: the server forwards the tracks published to the other members, and the room and its peers work as without it.
 */
export class Room<Connection extends PeerConnectionLike<any> = PeerConnectionLike> extends Emitter<RoomEvents<Connection>> {

    /**
     * The name of the room.
     */
    public readonly name: string

    readonly #host: RoomHost<Connection>

    readonly #peers: Map<string, Peer<Connection>> = new Map()

    //The peers whose connection is created, given to the listeners of peer
    readonly #ready: Set<Peer<Connection>> = new Set()

    //The tracks published, and the transceivers of the room sending them (reused for the next ones)
    readonly #published: Map<TrackOf<Connection>, Publication<Connection>> = new Map()

    readonly #transceivers: WeakSet<TransceiverLike> = new WeakSet()

    //With a media server: the streams it sends, by their id on the connection to it
    readonly #streams: Map<string, SignalingStream> = new Map()

    //The tracks and the channels received through the media server not given to their peer yet (its member or its
    //stream unknown yet), MAX_UNROUTED of each at most
    readonly #unrouted: TrackEventOf<Connection>[] = []

    readonly #unroutedChannels: UnroutedChannel<ChannelOf<Connection>>[] = []

    //The messages to the media server waiting for its control channel
    readonly #controls: string[] = []

    #metadata: unknown

    #left: boolean = false

    //The id of the media server of the room, and the peer of its connection
    #sfu?: string

    #server?: Peer<Connection>

    #control?: ChannelOf<Connection>

    /**
     * Create a room (by the signaling session joining it).
     * @param host The session.
     * @param name The room.
     * @param metadata The metadata the local member joined with.
     */
    constructor(host: RoomHost<Connection>, name: string, metadata: unknown) {
        super()
        this.#host = host
        this.name = name
        this.#metadata = metadata
    }

    /**
     * The peers whose connection is created.
     */
    public get peers(): Peer<Connection>[] {
        return [...this.#ready]
    }

    /**
     * The metadata the local member joined with.
     */
    public get metadata(): unknown {
        return this.#metadata
    }

    /**
     * Whether the room was left.
     */
    public get left(): boolean {
        return this.#left
    }

    /**
     * The id of the media server of the room, when it has one: the members are connected to it, not to each other.
     */
    public get sfu(): string | undefined {
        return this.#sfu
    }

    /**
     * The peer of a member.
     * @param id The member's id.
     * @returns The peer, or undefined when the member is not in the room or its connection is not created yet.
     */
    public peer(id: string): Peer<Connection> | undefined {
        const peer: Peer<Connection> | undefined = this.#peers.get(id)
        return peer && this.#ready.has(peer) ? peer : undefined
    }

    /**
     * A stream received through the media server of the room: the member sending it, and its id on the connection of
     * that member (`event.streams` of a track carries the ids of the connection to the server).
     * @param id The id of the stream on the connection to the server.
     * @returns The stream, or undefined when the room has no media server or the stream is not known.
     */
    public streamOf(id: string): SignalingStream | undefined {
        return this.#streams.get(id)
    }

    /**
     * Send a track to every member of the room, those joining later too: on each connection, or once to the media
     * server of the room. A track published after `unpublish()` takes the transceiver of a track unpublished.
     * @param track The track: a `MediaStreamTrack` in the browsers, a `MediaTrack` in Node.js.
     * @param streams Its streams (a `MediaStream` in the browsers, its id in Node.js): the members group the tracks of
     * a stream (to play the audio and the video together).
     * @returns Resolves once the track is added to the connections.
     */
    public async publish(track: TrackOf<Connection>, ...streams: StreamOf<Connection>[]): Promise<void> {
        if (this.#left || this.#published.has(track)) return
        const publication: Publication<Connection> = {streams: streams, transceivers: new Map()}
        this.#published.set(track, publication)
        const targets: Peer<Connection>[] = this.#sfu ? [this.#serverPeer()] : [...this.#peers.values()]
        await Promise.all(targets.map((peer: Peer<Connection>): Promise<void> => this.#send(peer, track)))
    }

    /**
     * Stop sending a track published: its transceivers stay, inactive, for the next track published.
     * @param track The track.
     * @returns Resolves once the track is taken out of the connections.
     */
    public async unpublish(track: TrackOf<Connection>): Promise<void> {
        const publication: Publication<Connection> | undefined = this.#published.get(track)
        if (!publication) return
        this.#published.delete(track)
        await Promise.all([...publication.transceivers.values()].map(async (transceiver: TransceiverLike): Promise<void> => {
            try {
                transceiver.direction = 'inactive'
                await transceiver.sender.replaceTrack(null)
            } catch {
                //Its connection is closed
            }
        }))
    }

    /**
     * Add a listener of an event; a listener of `peer` is called at once for the peers already there.
     * @param event The event.
     * @param listener The listener.
     * @returns This room.
     */
    public on<Event extends keyof RoomEvents<Connection>>(event: Event, listener: EmitterListener<RoomEvents<Connection>[Event]>): this {
        super.on(event, listener)
        if (event === 'peer') for (const peer of [...this.#ready]) (listener as EmitterListener<[Peer<Connection>]>)(peer)
        return this
    }

    /**
     * Leave the room: its peers are closed.
     * @returns Resolves once the server is told.
     */
    public async leave(): Promise<void> {
        if (this.#left) return
        this.#left = true
        for (const peer of [...this.#peers.values()]) peer.close()
        this.#server?.close()
        this.emit('close')
        await this.#host.leave(this)
    }

    /**
     * The members in the room when it was joined, or joined again after a reconnection of the signaling: the peers of
     * the members not there any more are dropped (unless their connection is up), the new members get a peer
     * @param peers
     * @param metadata
     * @param sfu The media server of the room, when it has one.
     * @internal
     */
    public members(peers: SignalingPeer[], metadata: unknown, sfu?: string): void {
        this.#metadata = metadata
        this.#sfu = sfu
        const present: Set<string> = new Set(peers.map((peer: SignalingPeer): string => peer.peerId))
        if (this.#server && !present.has(this.#server.id)) this.#server.left()
        for (const peer of [...this.#peers.values()]) {
            if (!present.has(peer.id)) peer.left()
        }
        //The media server first: the other peers use its connection
        const ordered: SignalingPeer[] = [...peers].sort((a: SignalingPeer, b: SignalingPeer): number => Number(b.peerId === sfu) - Number(a.peerId === sfu))
        for (const member of ordered) this.joined({room: this.name, ...member})
        for (const peer of this.#peers.values()) peer.signalingUp()
        this.#server?.signalingUp()
    }

    /**
     * A member joined (or joined again)
     * @param event
     * @internal
     */
    public joined(event: SignalingPeerEvent): void {
        if (this.#left || event.peerId === this.#host.localId) return
        if (event.role === 'sfu') {
            //The media server of the room; the one of another node is not connected to
            if (event.peerId !== this.#sfu) return
            if (this.#server && !this.#server.closed && (this.#server.session === event.session || event.session === undefined)) return this.#server.rejoined(event.metadata)
            this.#server?.close()
            this.#serverPeer(event.metadata, event.session)
            return
        }
        const peer: Peer<Connection> | undefined = this.#peers.get(event.peerId)
        if (peer && !peer.closed && (peer.session === event.session || event.session === undefined)) {
            peer.rejoined(event.metadata)
            return
        }
        //A new client behind the same id (a reloaded page): its old connection is useless
        peer?.close()
        this.#add(event.peerId, event.metadata, event.session)
    }

    /**
     * A member left
     * @param event
     * @internal
     */
    public departed(event: SignalingPeerLeftEvent): void {
        const peer: Peer<Connection> | undefined = event.peerId === this.#server?.id ? this.#server : this.#peers.get(event.peerId)
        if (!peer) return
        if (event.reason === 'left') {
            peer.close()
        } else {
            peer.left()
        }
    }

    /**
     * A signal from a member
     * @param event
     * @internal
     */
    public signal(event: SignalingSignalEvent): void {
        if (this.#left) return
        const signal: PeerSignal = {}
        if (event.description) signal.description = event.description
        if (event.candidate) signal.candidate = event.candidate
        if (this.#sfu) {
            //Through the media server only; its streams are known before its description fires the track events
            if (event.from !== this.#sfu) return
            for (const stream of event.streams ?? []) this.#streams.set(stream.id, stream)
            let server: Peer<Connection> = this.#serverPeer()
            if (event.session !== undefined && server.session !== undefined && server.session !== event.session) {
                server.close()
                server = this.#serverPeer(undefined, event.session)
            }
            server.receive(signal)
            this.#route()
            return
        }
        let peer: Peer<Connection> | undefined = this.#peers.get(event.from)
        if (peer && event.session !== undefined && peer.session !== undefined && peer.session !== event.session) {
            peer.close()
            peer = undefined
        }
        //A member whose joining was not seen (it joined while the signaling was reconnecting)
        peer ??= this.#add(event.from, undefined, event.session)
        peer.receive(signal)
    }

    /**
     * The peer of the media server: created once, its connection carrying the media of all the members
     * @param metadata
     * @param session
     */
    #serverPeer(metadata?: unknown, session?: string): Peer<Connection> {
        if (this.#server && !this.#server.closed) return this.#server
        const roomHost: RoomHost<Connection> = this.#host
        const host: PeerHost<Connection> = {
            localId: this.#host.localId,
            create: (): Connection | Promise<Connection> => this.#host.create({headerExtensions: true}),
            send: (to: string, signal: PeerSignal): Promise<void> => this.#host.send(this.name, to, signal),
            get signalingUp(): boolean {
                return roomHost.signalingUp
            },
            closed: (closed: Peer<Connection>): void => {
                if (this.#server === closed) this.#control = undefined
            },
            //The media server never gives up its offers
            polite: true
        }
        const server: Peer<Connection> = new Peer(host, this.#sfu!, metadata, session)
        this.#server = server
        server.on('error', (error: Error): void => void this.emit('error', error, server))
        server.on('track', (event: TrackEventOf<Connection>): void => {
            this.#unrouted.push(event)
            if (this.#unrouted.length > MAX_UNROUTED) this.#unrouted.shift()
            this.#route()
        })
        server.on('datachannel', (channel: ChannelOf<Connection>): void => {
            //Its messages wait with it, given again once its peer has it
            const early: unknown[] = []
            const keep = (event: {data: unknown}): number => early.push(event.data)
            channel.addEventListener('message', keep)
            this.#unroutedChannels.push({channel: channel, early: early, keep: keep})
            if (this.#unroutedChannels.length > MAX_UNROUTED) this.#unroutedChannels.shift()!.channel.close()
            this.#route()
        })
        //The server offers first: Chrome cannot answer it after rolling back an offer of its own whose data channel had
        //another media id ("Failed to start SCTP transport")
        server.ready.then((): Promise<void> => server.negotiated).then((): void => {
            if (server.closed) return
            //The control channel, negotiated by both sides
            const control: ChannelOf<Connection> = server.connection.createDataChannel(SignalingControlChannel.label, {negotiated: true, id: SignalingControlChannel.id}) as ChannelOf<Connection>
            this.#control = control
            control.addEventListener('open', (): void => {
                for (const message of this.#controls.splice(0)) control.send(message)
            })
            for (const track of this.#published.keys()) this.#sendLater(server, track)
        }, (error: Error): void => {
            this.emit('error', error, server)
            server.close()
        })
        return server
    }

    /**
     * Give the tracks and the channels received through the media server to the peers of their members: a track by its
     * stream, a channel by its protocol
     */
    #route(): void {
        for (const event of [...this.#unrouted]) {
            const id: string | undefined = (event as {streams?: ReadonlyArray<{id: string}>}).streams?.[0]?.id
            const stream: SignalingStream | undefined = id === undefined ? undefined : this.#streams.get(id)
            const peer: Peer<Connection> | undefined = stream ? this.#peers.get(stream.peerId) : undefined
            if (!peer || !this.#ready.has(peer)) continue
            this.#unrouted.splice(this.#unrouted.indexOf(event), 1)
            peer.relayedTrack(event)
        }
        for (const unrouted of [...this.#unroutedChannels]) {
            const {channel, early, keep} = unrouted
            const peer: Peer<Connection> | undefined = this.#peers.get((channel as {protocol?: string}).protocol ?? '')
            if (!peer || !this.#ready.has(peer)) continue
            this.#unroutedChannels.splice(this.#unroutedChannels.indexOf(unrouted), 1)
            channel.removeEventListener('message', keep)
            peer.relayedChannel(channel)
            for (const data of early) channel.dispatchEvent(new MessageEvent('message', {data: data}))
        }
    }

    /**
     * Send a message to the media server, once its control channel is open
     * @param message
     */
    #controlSend(message: SignalingControlMessage): void {
        const data: string = JSON.stringify(message)
        if (this.#control?.readyState === 'open') {
            this.#control.send(data)
        } else {
            this.#controls.push(data)
        }
    }

    /**
     * Send a track published on the connection of a peer: on a transceiver of a track unpublished, else on a new one
     * (not one the other side offered, which may be receiving another track)
     * @param peer
     * @param track
     */
    async #send(peer: Peer<Connection>, track: TrackOf<Connection>): Promise<void> {
        try {
            await peer.ready
            if (peer === this.#server) await peer.negotiated
        } catch {
            return
        }
        const publication: Publication<Connection> | undefined = this.#published.get(track)
        const connection: Connection = peer.connection
        if (peer.closed || !publication || publication.transceivers.has(connection)) return
        const taken: Set<TransceiverLike> = new Set([...this.#published.values()].flatMap((each: Publication<Connection>): TransceiverLike[] => [...each.transceivers.values()]))
        const reusable: TransceiverLike | undefined = connection.getTransceivers().find((transceiver: TransceiverLike): boolean => this.#transceivers.has(transceiver)
            && !taken.has(transceiver)
            && !transceiver.sender.track
            && transceiver.direction === 'inactive'
            && transceiver.currentDirection === 'inactive'
            && transceiver.receiver.track.kind === (track as {kind: string}).kind)
        if (!reusable) {
            const transceiver: TransceiverLike = connection.addTransceiver(track, {direction: 'sendonly', streams: publication.streams})
            this.#transceivers.add(transceiver)
            publication.transceivers.set(connection, transceiver)
            return
        }
        publication.transceivers.set(connection, reusable)
        await reusable.sender.replaceTrack(track)
        reusable.sender.setStreams(...publication.streams)
        reusable.direction = 'sendonly'
    }

    /**
     * Send a track published on the connection of a new peer; a failure is an error of the room
     * @param peer
     * @param track
     */
    #sendLater(peer: Peer<Connection>, track: TrackOf<Connection>): void {
        this.#send(peer, track).catch((error: Error): void => void this.emit('error', error, peer))
    }

    /**
     * Create the peer of a member; the listeners of peer get it once its connection is created
     * @param id
     * @param metadata
     * @param session
     */
    #add(id: string, metadata: unknown, session: string | undefined): Peer<Connection> {
        const roomHost: RoomHost<Connection> = this.#host
        const host: PeerHost<Connection> = {
            localId: this.#host.localId,
            create: (): Connection | Promise<Connection> => this.#host.create(),
            send: (to: string, signal: PeerSignal): Promise<void> => this.#host.send(this.name, to, signal),
            get signalingUp(): boolean {
                return roomHost.signalingUp
            },
            closed: (closed: Peer<Connection>): void => {
                if (this.#peers.get(closed.id) === closed) this.#peers.delete(closed.id)
                for (const publication of this.#published.values()) {
                    if (!this.#sfu && closed.connection) publication.transceivers.delete(closed.connection)
                }
                if (this.#ready.delete(closed)) this.emit('peer-left', closed)
            },
            ...this.#sfu ? {relay: this.#serverPeer(), control: (message: SignalingControlMessage): void => this.#controlSend(message)} : {}
        }
        const peer: Peer<Connection> = new Peer(host, id, metadata, session)
        this.#peers.set(id, peer)
        peer.on('error', (error: Error): void => void this.emit('error', error, peer))
        peer.ready.then((): void => {
            if (peer.closed) return
            this.#ready.add(peer)
            this.emit('peer', peer)
            if (this.#sfu) {
                this.#route()
            } else {
                for (const track of this.#published.keys()) this.#sendLater(peer, track)
            }
        }, (error: Error): void => {
            this.emit('error', error, peer)
            peer.close()
        })
        return peer
    }
}
