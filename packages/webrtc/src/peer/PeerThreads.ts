import os from 'node:os'
import type {HeapInfo} from 'node:v8'
import {type ResourceLimits, Worker} from 'node:worker_threads'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {debug, debugHandlerWatchers, hasDebugHandler} from '../lib/common/log.js'
import type {EngineOptions} from './EngineConfig.js'
import {PeerThreadChannel, type PeerThreadPort} from './PeerThreadChannel.js'
import type {PeerConnectionState, PeerFromWorker, PeerToWorker, PeerWorkerData} from './PeerThreadProtocol.js'
import {peerWorkerCode} from './PeerWorkerCode.js'
import {type PeerThreadLink, RemoteConnection} from './RemoteConnection.js'

const log = debug('webrtc/peer/threads')

/**
 * How long a thread asked to stop has to close its connections, in milliseconds
 */
const STOP_TIMEOUT: number = 5000

/**
 * The parallelism the system advises: os.availableParallelism (Node.js 18.14, 19.4), else the cores
 */
function parallelism(): number {
    //node-compat: os.availableParallelism
    return typeof os.availableParallelism === 'function' ? os.availableParallelism() : Math.max(1, os.cpus().length)
}

/**
 * The options of {@link PeerThreads} (see {@link buildPeerThreadsOptions}).
 */
export interface PeerThreadsOptions {
    /**
     * The worker threads at most. They start when needed: a new connection goes to a thread serving none (a new one is
     * started while there are fewer than this), else to the thread serving the fewest.
     * @default the number of cores less one, at least 1
     */
    threads?: number
    /**
     * The limits of the heap and of the stack of each thread (`resourceLimits` of `node:worker_threads`). Bun ignores
     * them.
     * @default the limits of V8
     */
    resourceLimits?: ResourceLimits
}

/**
 * A worker thread, started when needed
 */
interface Slot {
    readonly index: number
    worker?: Worker
    channel?: PeerThreadChannel<PeerToWorker, PeerFromWorker>
    ready?: Promise<void>
    //Its connections, and the ones being opened in it
    readonly connections: Map<number, RemoteConnection>
    opening: number
}

/**
 * Worker threads serving connections, to use more cores: a {@link PeerConnection} given the name of this component
 * (its `threads` option) runs its ICE, DTLS, SCTP and SRTP there, while its object, its events and the messages of its
 * channels stay in the main thread. Each connection is served by one thread for its whole life; a thread that stops
 * (only a bug stops one) fails its connections (`failed`, then `closed`), and is started again for the next ones.
 *
 * Not on Node.js 18 and 19: on Node.js 18 a worker thread receiving the datagrams of its connections can end the process
 * (a fatal error of Node.js), and Node.js 19 is not known to be free of it. The connections served in the main thread
 * (without this component) are not concerned.
 *
 * Register it with {@link buildPeerThreadsOptions}; the threads stop when the application does.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildPeerThreadsOptions, PeerConnection} from '@lakutata/webrtc'
 *
 * Application
 *     .run(() => ({
 *         id: 'peers.app',
 *         name: 'Peers',
 *         components: {
 *             peerThreads: buildPeerThreadsOptions({threads: 4})
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         //Its engine runs in one of the four threads
 *         const connection: PeerConnection = await app.getObject(PeerConnection, {threads: 'peerThreads'})
 *         connection.createDataChannel('data')
 *     })
 * ```
 */
@Singleton()
export class PeerThreads extends Component {

    /**
     * The worker threads at most.
     */
    @Configurable(DTO.Number().integer().positive().optional())
    protected readonly threads?: number

    /**
     * The limits of the heap and of the stack of each thread.
     */
    @Configurable(DTO.Object({
        maxYoungGenerationSizeMb: DTO.Number().positive().optional(),
        maxOldGenerationSizeMb: DTO.Number().positive().optional(),
        codeRangeSizeMb: DTO.Number().positive().optional(),
        stackSizeMb: DTO.Number().positive().optional()
    }).optional())
    protected readonly resourceLimits?: ResourceLimits

    #slots: Slot[] = []

    #nextConnection: number = 1

    #stopping: boolean = false

    //Tells the threads whether the main thread has a debug handler
    readonly #debugging = (set: boolean): void => {
        for (const slot of this.#slots) slot.channel?.post({type: 'debug', enabled: set})
    }

    /**
     * Prepare the threads (they start when needed).
     * @protected
     */
    protected async init(): Promise<void> {
        if (!peerWorkerCode) throw new Error('The code of the worker threads of the connections is not built (scripts/workers.mjs)')
        const count: number = this.threads ?? Math.max(1, parallelism() - 1)
        this.#slots = Array.from({length: count}, (_: unknown, index: number): Slot => ({index: index, connections: new Map(), opening: 0}))
        debugHandlerWatchers.add(this.#debugging)
    }

    /**
     * Stop the threads, closing their connections.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#stopping = true
        debugHandlerWatchers.delete(this.#debugging)
        await Promise.all(this.#slots.map((slot: Slot): Promise<void> => this.#stop(slot)))
    }

    /**
     * Open a connection in a thread.
     * @param options The options of its engine.
     * @returns The connection, as the main thread sees it.
     * @internal
     */
    public async open(options: EngineOptions): Promise<RemoteConnection> {
        if (this.#stopping) throw Object.assign(new Error('The worker threads of the connections are stopping'), {name: 'InvalidStateError'})
        const slot: Slot = this.#choose()
        slot.opening++
        try {
            await this.#start(slot)
            const conn: number = this.#nextConnection++
            const channel: PeerThreadChannel<PeerToWorker, PeerFromWorker> = slot.channel!
            const link: PeerThreadLink = {
                request: <Result>(message: PeerToWorker, transfer?: ArrayBuffer[]): Promise<Result> => channel.request<Result>(message, transfer),
                post: (message: PeerToWorker, transfer?: ArrayBuffer[]): void => channel.post(message, transfer),
                postOrExtend: (extend: (last: PeerToWorker) => boolean, message: () => PeerToWorker, transfer?: ArrayBuffer[]): void => channel.postOrExtend(extend, message, transfer),
                pack: (data: Uint8Array): {bytes: Uint8Array, transfer?: ArrayBuffer[]} => channel.pack(data),
                release: (released: number): unknown => slot.connections.delete(released)
            }
            //Known before it is opened: its first events may come before the reply
            const connection: RemoteConnection = new RemoteConnection(link, conn)
            slot.connections.set(conn, connection)
            try {
                connection.opened(await channel.request<PeerConnectionState>({type: 'open', conn: conn, options: options}))
            } catch (error) {
                slot.connections.delete(conn)
                throw error
            }
            return connection
        } finally {
            slot.opening--
        }
    }

    /**
     * The connections of each thread.
     * @returns Their numbers, by thread (0 for a thread not started).
     * @internal
     */
    public load(): number[] {
        return this.#slots.map((slot: Slot): number => slot.connections.size)
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
     * Stop a thread as a bug would (for the tests).
     * @param index The thread.
     * @internal
     */
    public async crash(index: number): Promise<void> {
        await this.#slots[index]?.worker?.terminate()
    }

    /**
     * The thread of a new connection: one serving none (started first), else a new one while there are fewer than the
     * threads at most, else the one serving the fewest
     */
    #choose(): Slot {
        const loadOf = (slot: Slot): number => slot.connections.size + slot.opening
        const started: Slot[] = this.#slots.filter((slot: Slot): boolean => !!slot.worker)
        const idle: Slot | undefined = started.find((slot: Slot): boolean => loadOf(slot) === 0)
        if (idle) return idle
        const free: Slot | undefined = this.#slots.find((slot: Slot): boolean => !slot.worker)
        if (free) return free
        return started.reduce((least: Slot, slot: Slot): Slot => loadOf(slot) < loadOf(least) ? slot : least)
    }

    /**
     * Start the thread of a slot, unless it runs
     * @param slot
     */
    #start(slot: Slot): Promise<void> {
        if (slot.ready) return slot.ready
        const worker: Worker = new Worker(peerWorkerCode, {
            eval: true,
            workerData: {thread: slot.index} satisfies PeerWorkerData,
            ...this.resourceLimits ? {resourceLimits: this.resourceLimits} : {}
        })
        slot.worker = worker
        let ready: () => void
        let failed: (error: Error) => void
        slot.ready = new Promise((resolve: () => void, reject: (error: Error) => void): void => {
            ready = resolve
            failed = reject
        })
        const channel: PeerThreadChannel<PeerToWorker, PeerFromWorker> = new PeerThreadChannel(worker as unknown as PeerThreadPort, (message: PeerFromWorker): void => {
            switch (message.type) {
                case 'ready':
                    return ready()
                case 'log':
                    return debug(message.namespace)(message.message)
                default:
                    return slot.connections.get(message.conn)?.handle(message)
            }
        })
        slot.channel = channel
        if (hasDebugHandler()) channel.post({type: 'debug', enabled: true})
        worker.on('error', (error: Error): void => log('the worker thread %d failed: %O', slot.index, error))
        worker.on('exit', (code: number): void => {
            if (slot.worker !== worker) return
            if (!this.#stopping) log('the worker thread %d stopped (exit code %d)', slot.index, code)
            const error: Error = Object.assign(new Error('The worker thread of the connection stopped'), {name: 'InvalidStateError'})
            failed(error)
            channel.close(error)
            slot.worker = undefined
            slot.channel = undefined
            slot.ready = undefined
            const lost: RemoteConnection[] = [...slot.connections.values()]
            slot.connections.clear()
            for (const connection of lost) connection.lost(!this.#stopping)
        })
        return slot.ready
    }

    /**
     * Stop the thread of a slot, closing its connections
     * @param slot
     */
    async #stop(slot: Slot): Promise<void> {
        const worker: Worker | undefined = slot.worker
        const channel: PeerThreadChannel<PeerToWorker, PeerFromWorker> | undefined = slot.channel
        if (!worker || !channel) return
        let timer: NodeJS.Timeout | undefined
        await Promise.race([
            channel.request({type: 'stop'}).catch((): undefined => undefined),
            new Promise<void>((resolve: () => void): void => {
                timer = setTimeout(resolve, STOP_TIMEOUT)
            })
        ])
        clearTimeout(timer)
        await worker.terminate()
    }
}

/**
 * Build the options of a {@link PeerThreads} component, for the `components` of an application.
 * @param options The threads at most, their limits (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildPeerThreadsOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'peers.app',
 *     name: 'Peers',
 *     components: {
 *         peerThreads: buildPeerThreadsOptions({threads: 4})
 *     }
 * }))
 * ```
 */
export function buildPeerThreadsOptions(options: PeerThreadsOptions = {}): ComponentOptions<PeerThreadsOptions> {
    return {class: PeerThreads, ...options}
}
