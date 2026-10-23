import {type HeapInfo} from 'node:v8'
import {type ResourceLimits, Worker} from 'node:worker_threads'
import {debug, debugHandlerWatchers, hasDebugHandler} from '../lib/common/log.js'
import {RTCRtpCodecParameters} from '../lib/peer/media/parameters.js'
import {RtpPacket as EngineRtpPacket} from '../lib/rtp/rtp/rtp.js'
import type {EndpointLeg} from '../peer/Endpoints.js'
import {type MediaTrack, relayedTrack} from '../peer/MediaTrack.js'
import type {SignalingDescription, SignalingPeer} from '../protocol/SignalingProtocol.js'
import type {Signaling} from '../signaling/Signaling.js'
import type {SFUTrack} from './SFU.js'
import type {SFUOfferedTrack, SFUServedRoom, SFUViewerSelect} from './SFURoom.js'
import type {SFUWorkerData} from './SFUWorker.js'
import {type SFUFromWorker, type SFUToWorker, SFUWorkerChannel, type SFUWorkerMedia} from './SFUWorkerChannel.js'
import {sfuWorkerCode} from './SFUWorkerCode.js'

const log = debug('webrtc/sfu/workers')

/**
 * How long a worker thread may take to leave its rooms when the server stops, in milliseconds
 */
const STOP_TIMEOUT: number = 5000

/**
 * What the worker threads need of the media server
 */
export interface SFUWorkersHost {
    //The id of the member of the server
    readonly id: string
    readonly signaling: Signaling
    readonly select?: (subscriber: SignalingPeer, track: SFUTrack) => boolean
    emit(event: string, ...args: unknown[]): unknown
    //The last member of a room left
    emptied(room: SFUServedRoom): void
    //The worker thread of a room stopped: the room is closed, its connections are gone
    lost(room: SFUServedRoom): void
    //The source of a viewer of WHEP changed
    sourced?(viewerId: string, source: string | undefined): void
    //The limits of the heap and the stack of each thread
    readonly resourceLimits?: ResourceLimits
}

/**
 * A worker thread, and the rooms it forwards
 */
interface Slot {
    readonly index: number
    readonly rooms: Map<number, SFUWorkerRoom>
    worker?: Worker
    channel?: SFUWorkerChannel<SFUFromWorker, SFUToWorker>
    //Resolves once the thread runs
    ready: Promise<void>
    started?: {resolve(): void, reject(error: Error): void}
    //It ran (a thread stopping later is started again); it failed to start (it is not started again)
    ran: boolean
    dead: boolean
}

/**
 * What a room in a worker thread needs of the pool
 */
interface RoomLink {
    readonly id: string
    readonly slot: Slot
    readonly legs: Map<string, WorkerLeg>
    readonly choosers: Map<string, SFUViewerSelect>
    emit(event: string, ...args: unknown[]): unknown
}

/**
 * The key of several values
 * @param parts
 */
function keyOf(...parts: (string | number)[]): string {
    return parts.join('\n')
}

/**
 * The channel of a running thread
 * @param slot
 */
function channelOf(slot: Slot): SFUWorkerChannel<SFUFromWorker, SFUToWorker> {
    if (!slot.channel) throw new Error('The worker thread of the media server is not running')
    return slot.channel
}

/**
 * The connection of a session of WHIP or WHEP in a worker thread
 */
class WorkerLeg implements EndpointLeg {

    readonly #link: RoomLink

    readonly #id: string

    readonly #listeners: (() => void)[] = []

    #ended: boolean = false

    #source: string | undefined

    /**
     * The answer, with all the candidates.
     */
    public readonly answer: SignalingDescription

    /**
     * Keep a leg.
     * @param link The pool.
     * @param id The id of its member or viewer.
     * @param answer The answer.
     * @param source The source of a viewer.
     */
    constructor(link: RoomLink, id: string, answer: SignalingDescription, source?: string) {
        this.#link = link
        this.#id = id
        this.answer = answer
        this.#source = source
        link.legs.set(id, this)
    }

    /**
     * The source of a viewer of WHEP.
     */
    public source(): string | undefined {
        return this.#source
    }

    /**
     * The source of a viewer changed.
     * @param source
     */
    public sourced(source: string | undefined): void {
        this.#source = source
    }

    /**
     * Apply a PATCH in the worker thread.
     * @param fragment
     * @param restart
     */
    public patch(fragment: string, restart: boolean): Promise<string | undefined | null> {
        if (this.#ended) return Promise.reject(new Error('The session ended'))
        return channelOf(this.#link.slot).request<string | undefined | null>({type: 'patch', leg: this.#id, fragment: fragment, restart: restart})
    }

    /**
     * Call a listener once the leg ends.
     * @param listener
     */
    public ended(listener: () => void): void {
        if (this.#ended) listener()
        else this.#listeners.push(listener)
    }

    /**
     * Close the connection.
     */
    public close(): void {
        if (this.#ended) return
        this.#link.slot.channel?.post({type: 'end', leg: this.#id})
        this.end()
    }

    /**
     * The connection is gone.
     */
    public end(): void {
        if (this.#ended) return
        this.#ended = true
        if (this.#link.legs.get(this.#id) === this) this.#link.legs.delete(this.#id)
        this.#link.choosers.delete(this.#id)
        for (const listener of this.#listeners.splice(0)) listener()
    }
}

/**
 * A room forwarded in a worker thread, from the main thread: its members, its tracks and its viewers as the thread
 * tells them, the tracks read here, and its sessions of WHIP and WHEP
 */
export class SFUWorkerRoom implements SFUServedRoom {

    readonly #link: RoomLink

    readonly #ref: number

    #closed: boolean = false

    #closing?: Promise<void>

    #members: string[] = []

    #viewers: number = 0

    //The tracks published, the ids and the codecs of their tracks of the engine, the ones read here (by member and track)
    readonly #tracks: Map<string, SFUTrack> = new Map()

    readonly #media: Map<string, SFUWorkerMedia> = new Map()

    //The tracks of the other nodes of the room, as the thread knows them
    #known: Map<string, SFUOfferedTrack> = new Map()

    readonly #relayed: Map<string, {track: MediaTrack, receive(packet: EngineRtpPacket, extensions?: Record<string, unknown>): void}> = new Map()

    readonly #legs: Set<WorkerLeg> = new Set()

    /**
     * The name of the room.
     */
    public readonly name: string

    /**
     * Resolves once the server is in the room.
     */
    public readonly ready: Promise<void>

    /**
     * Open a room in a worker thread.
     * @param link The pool.
     * @param ref The number of the room in the pool.
     * @param name The room.
     */
    constructor(link: RoomLink, ref: number, name: string) {
        this.#link = link
        this.#ref = ref
        this.name = name
        this.ready = link.slot.ready.then((): Promise<void> => channelOf(link.slot).request({type: 'open', ref: ref, room: name, id: link.id}))
        this.ready.catch((): void => undefined)
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
        return this.#members
    }

    /**
     * The tracks published.
     */
    public get tracks(): SFUTrack[] {
        return [...this.#tracks.values()]
    }

    /**
     * The number of the viewers of WHEP.
     */
    public get viewers(): number {
        return this.#viewers
    }

    /**
     * A track published: its packets come from the worker thread while they are read, or sent on, here.
     * @param peerId
     * @param trackId
     */
    public track(peerId: string, trackId: string): MediaTrack | undefined {
        const key: string = keyOf(peerId, trackId)
        //A track of a member of this node, else of another node of the room
        const published: SFUTrack | undefined = this.#tracks.get(key) ?? this.#known.get(key)?.track
        if (!published || this.#closed) return undefined
        let relayed = this.#relayed.get(key)
        if (!relayed) {
            const codec = (this.#media.get(key) ?? this.#known.get(key))?.codec ?? {mimeType: published.codec, clockRate: published.kind === 'audio' ? 48000 : 90000}
            relayed = relayedTrack(published.kind, new RTCRtpCodecParameters(codec), this.#media.get(key)?.id ?? (this.#known.has(key) ? trackId : undefined), {
                requestKeyFrame: (): void => this.#link.slot.channel?.post({type: 'keyframe', ref: this.#ref, peerId: peerId, trackId: trackId}),
                wanted: (wanted: boolean): void => this.#link.slot.channel?.post({type: 'stream', ref: this.#ref, peerId: peerId, trackId: trackId, wanted: wanted})
            })
            this.#relayed.set(key, relayed)
        }
        return relayed.track
    }

    /**
     * A stream published with WHIP joins the room.
     * @param id
     * @param offer
     */
    public async publish(id: string, offer: SignalingDescription): Promise<EndpointLeg> {
        const {answer} = await channelOf(this.#link.slot).request<{answer: SignalingDescription}>({type: 'publish', ref: this.#ref, peerId: id, offer: offer})
        return this.#keep(new WorkerLeg(this.#link, id, answer))
    }

    /**
     * A viewer of WHEP receives a member of the room.
     * @param id
     * @param offer
     * @param select
     */
    public async play(id: string, offer: SignalingDescription, select?: SFUViewerSelect): Promise<EndpointLeg & {source(): string | undefined}> {
        if (select) this.#link.choosers.set(id, select)
        let played: {answer: SignalingDescription, source?: string}
        try {
            played = await channelOf(this.#link.slot).request<{answer: SignalingDescription, source?: string}>({type: 'play', ref: this.#ref, viewerId: id, offer: offer, select: !!select})
        } catch (error) {
            this.#link.choosers.delete(id)
            throw error
        }
        return this.#keep(new WorkerLeg(this.#link, id, played.answer, played.source))
    }

    /**
     * Leave the room.
     */
    public close(): Promise<void> {
        this.#closing ??= (async (): Promise<void> => {
            this.#closed = true
            try {
                await this.ready
                await channelOf(this.#link.slot).request({type: 'close', ref: this.#ref})
            } catch {
                //Not opened, or its thread stopped
            }
            if (this.#link.slot.rooms.get(this.#ref) === this) this.#link.slot.rooms.delete(this.#ref)
            this.#end()
        })()
        return this.#closing
    }

    /**
     * Its thread stopped: the room is closed, its tracks unpublished.
     */
    public lose(): void {
        this.#closed = true
        const tracks: SFUTrack[] = [...this.#tracks.values()]
        this.#tracks.clear()
        this.#media.clear()
        for (const track of tracks) this.#link.emit('unpublish', track)
        this.#end()
    }

    /**
     * An event of the room: the tracks published are kept.
     * @param event
     * @param args
     * @param media The track of the engine of a track published.
     */
    public emitted(event: string, args: unknown[], media?: SFUWorkerMedia): void {
        const track: SFUTrack | undefined = args[0] as SFUTrack | undefined
        if (event === 'publish' && track) {
            this.#tracks.set(keyOf(track.peerId, track.id), track)
            if (media) this.#media.set(keyOf(track.peerId, track.id), media)
        } else if (event === 'unpublish' && track) {
            const key: string = keyOf(track.peerId, track.id)
            this.#tracks.delete(key)
            this.#media.delete(key)
            this.#relayed.get(key)?.track.stop()
            this.#relayed.delete(key)
        }
    }

    /**
     * The tracks of the other nodes of the room changed: the ones gone end here.
     * @param tracks
     */
    public knew(tracks: SFUOfferedTrack[]): void {
        this.#known = new Map(tracks.map((offered: SFUOfferedTrack): [string, SFUOfferedTrack] => [keyOf(offered.track.peerId, offered.track.id), offered]))
        for (const [key, relayed] of [...this.#relayed]) {
            if (this.#tracks.has(key) || this.#known.has(key)) continue
            relayed.track.stop()
            this.#relayed.delete(key)
        }
    }

    /**
     * The members and the number of the viewers changed.
     * @param members
     * @param viewers
     */
    public state(members: string[], viewers: number): void {
        this.#members = members
        this.#viewers = viewers
    }

    /**
     * A packet of a track read here.
     * @param peerId
     * @param trackId
     * @param packet
     * @param extensions
     */
    public received(peerId: string, trackId: string, packet: Uint8Array, extensions?: Record<string, unknown>): void {
        this.#relayed.get(keyOf(peerId, trackId))?.receive(EngineRtpPacket.deSerialize(Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength)), extensions)
    }

    /**
     * Keep a leg of the room
     * @param leg
     */
    #keep(leg: WorkerLeg): WorkerLeg {
        this.#legs.add(leg)
        leg.ended((): boolean => this.#legs.delete(leg))
        return leg
    }

    /**
     * The tracks read here end, the legs are gone
     */
    #end(): void {
        for (const relayed of this.#relayed.values()) relayed.track.stop()
        this.#relayed.clear()
        for (const leg of [...this.#legs]) leg.end()
    }
}

/**
 * The worker threads of a media server: each forwards the rooms placed in it, the one forwarding the fewest members
 * and viewers taking the next room. A thread stopping (a bug) loses its rooms; it is started again.
 */
export class SFUWorkers {

    readonly #host: SFUWorkersHost

    readonly #data: SFUWorkerData[]

    readonly #slots: Slot[]

    //The legs of WHIP and WHEP, the choices of source of the viewers (by their ids)
    readonly #legs: Map<string, WorkerLeg> = new Map()

    readonly #choosers: Map<string, SFUViewerSelect> = new Map()

    #next: number = 1

    #stopping: boolean = false

    //Tells the threads whether the main thread has a debug handler
    readonly #debugging = (set: boolean): void => {
        for (const slot of this.#slots) slot.channel?.post({type: 'debug', enabled: set})
    }

    /**
     * Start the threads.
     * @param host The media server.
     * @param data What each thread is started with.
     * @throws {Error} When the code of the threads was not built.
     */
    constructor(host: SFUWorkersHost, data: SFUWorkerData[]) {
        if (!sfuWorkerCode) throw new Error('The code of the worker threads of the media server is not built (scripts/workers.mjs)')
        this.#host = host
        this.#data = data
        this.#slots = data.map((_: SFUWorkerData, index: number): Slot => ({index: index, rooms: new Map(), ready: Promise.resolve(), ran: false, dead: false}))
        debugHandlerWatchers.add(this.#debugging)
        for (const slot of this.#slots) this.#start(slot)
    }

    /**
     * Resolves once all the threads run.
     * @throws {Error} When one fails to start.
     */
    public get ready(): Promise<void> {
        return Promise.all(this.#slots.map((slot: Slot): Promise<void> => slot.ready)).then((): void => undefined)
    }

    /**
     * Open a room in the thread forwarding the fewest members and viewers.
     * @param name The room.
     * @returns The room.
     */
    public room(name: string): SFUWorkerRoom {
        const load = (slot: Slot): number => [...slot.rooms.values()].reduce((sum: number, room: SFUWorkerRoom): number => sum + 1 + room.members.length + room.viewers, 0)
        const live: Slot[] = this.#slots.filter((slot: Slot): boolean => !slot.dead)
        if (!live.length) throw new Error('No worker thread of the media server runs')
        const slot: Slot = live.reduce((least: Slot, each: Slot): Slot => load(each) < load(least) ? each : least)
        const ref: number = this.#next++
        const room: SFUWorkerRoom = new SFUWorkerRoom({
            id: this.#host.id,
            slot: slot,
            legs: this.#legs,
            choosers: this.#choosers,
            emit: (event: string, ...args: unknown[]): unknown => this.#host.emit(event, ...args)
        }, ref, name)
        slot.rooms.set(ref, room)
        return room
    }

    /**
     * The number of rooms of each thread.
     * @returns The numbers, in the order of the threads.
     */
    public get rooms(): number[] {
        return this.#slots.map((slot: Slot): number => slot.rooms.size)
    }

    /**
     * Stop the threads (their rooms closed before).
     */
    public async stop(): Promise<void> {
        this.#stopping = true
        debugHandlerWatchers.delete(this.#debugging)
        await Promise.all(this.#slots.map(async (slot: Slot): Promise<void> => {
            const worker: Worker | undefined = slot.worker
            if (!worker) return
            let timer: NodeJS.Timeout | undefined
            await Promise.race([
                channelOf(slot).request({type: 'stop'}).catch((): void => undefined),
                new Promise<void>((resolve: () => void): void => {
                    timer = setTimeout(resolve, STOP_TIMEOUT)
                })
            ])
            clearTimeout(timer)
            await worker.terminate()
        }))
    }

    /**
     * The thread forwarding a room.
     * @param name The room.
     * @returns The index of the thread, or undefined when no thread forwards the room.
     */
    public threadOf(name: string): number | undefined {
        return this.#slots.find((slot: Slot): boolean => [...slot.rooms.values()].some((room: SFUWorkerRoom): boolean => room.name === name && !room.closed))?.index
    }

    /**
     * Stop a thread now, as a bug would (to test what follows).
     * @param index The thread.
     * @internal
     */
    public async crash(index: number): Promise<void> {
        await this.#slots[index]?.worker?.terminate()
    }

    /**
     * The heap of each thread (to measure the memory of the threads).
     * @returns The statistics of the heap of each thread running, by its index.
     * @internal
     */
    public async heaps(): Promise<(HeapInfo | undefined)[]> {
        return await Promise.all(this.#slots.map((slot: Slot): Promise<HeapInfo | undefined> => slot.worker ? slot.worker.getHeapStatistics().catch((): undefined => undefined) : Promise.resolve(undefined)))
    }

    /**
     * The limits each thread runs with.
     * @returns The limits of each thread running, by its index.
     * @internal
     */
    public limits(): (ResourceLimits | undefined)[] {
        return this.#slots.map((slot: Slot): ResourceLimits | undefined => slot.worker?.resourceLimits)
    }

    /**
     * Start the thread of a slot
     * @param slot
     */
    #start(slot: Slot): void {
        //Running once it says so: a thread failing to start is not started again
        slot.ran = false
        const resourceLimits: ResourceLimits | undefined = this.#host.resourceLimits
        const worker: Worker = new Worker(sfuWorkerCode, {eval: true, workerData: this.#data[slot.index], ...resourceLimits ? {resourceLimits: resourceLimits} : {}})
        slot.worker = worker
        slot.channel = new SFUWorkerChannel<SFUFromWorker, SFUToWorker>(worker, (message: SFUFromWorker): unknown => this.#handle(slot, message))
        slot.ready = new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            slot.started = {resolve: resolve, reject: reject}
        })
        slot.ready.catch((): void => undefined)
        if (hasDebugHandler()) slot.channel.post({type: 'debug', enabled: true})
        //Its exit follows
        worker.on('error', (error: Error): void => log('the worker thread %d failed: %O', slot.index, error))
        worker.on('exit', (code: number): void => {
            if (!this.#stopping) log('the worker thread %d stopped (exit code %d)', slot.index, code)
            this.#exited(slot, worker)
        })
    }

    /**
     * A thread stopped: its rooms are lost, and it is started again, unless it never ran
     * @param slot
     * @param worker
     */
    #exited(slot: Slot, worker: Worker): void {
        if (slot.worker !== worker) return
        const error: Error = new Error('The worker thread of the media server stopped')
        slot.channel?.close(error)
        slot.started?.reject(error)
        slot.started = undefined
        slot.worker = undefined
        slot.channel = undefined
        const lost: SFUWorkerRoom[] = [...slot.rooms.values()]
        slot.rooms.clear()
        for (const room of lost) room.lose()
        if (this.#stopping) return
        if (slot.ran) this.#start(slot)
        else slot.dead = true
        for (const room of lost) this.#host.lost(room)
    }

    /**
     * A message of a thread
     * @param slot
     * @param message
     */
    #handle(slot: Slot, message: SFUFromWorker): unknown {
        switch (message.type) {
            case 'ready':
                slot.ran = true
                slot.started?.resolve()
                return undefined
            case 'join': {
                const room: SFUWorkerRoom | undefined = slot.rooms.get(message.ref)
                if (!room) throw new Error('The room is not served any more')
                const channel: SFUWorkerChannel<SFUFromWorker, SFUToWorker> = channelOf(slot)
                return this.#host.signaling.join(message.peerId, room.name, {
                    role: message.role,
                    receive: (event: string, payload: unknown): void => channel.post({type: 'receive', ref: message.ref, peerId: message.peerId, event: event, payload: payload})
                })
            }
            case 'leave': {
                const room: SFUWorkerRoom | undefined = slot.rooms.get(message.ref)
                return room ? this.#host.signaling.leave(message.peerId, room.name) : undefined
            }
            case 'signal': {
                const room: SFUWorkerRoom | undefined = slot.rooms.get(message.ref)
                return room ? this.#host.signaling.signal(message.peerId, room.name, message.to, message.signal) : false
            }
            case 'select':
                return this.#host.select ? this.#host.select(message.subscriber, message.track) : true
            case 'choose':
                return this.#choosers.get(message.leg)?.(message.tracks)
            case 'emit':
                slot.rooms.get(message.ref)?.emitted(message.event, message.args, message.media)
                return this.#host.emit(message.event, ...message.args)
            case 'state':
                return slot.rooms.get(message.ref)?.state(message.members, message.viewers)
            case 'source':
                this.#legs.get(message.leg)?.sourced(message.source)
                return this.#host.sourced?.(message.leg, message.source)
            case 'ended':
                return this.#legs.get(message.leg)?.end()
            case 'emptied': {
                const room: SFUWorkerRoom | undefined = slot.rooms.get(message.ref)
                return room ? this.#host.emptied(room) : undefined
            }
            case 'rtp':
                return slot.rooms.get(message.ref)?.received(message.peerId, message.trackId, message.packet, message.extensions)
            case 'log':
                return debug(message.namespace)(message.message)
            case 'known':
                return slot.rooms.get(message.ref)?.knew(message.tracks)
        }
    }
}
