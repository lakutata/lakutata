import {createSocket, type Socket} from 'node:dgram'
import {createServer, isIPv6, type AddressInfo, type Server} from 'node:net'
import {Worker} from 'node:worker_threads'
import {debug, debugHandlerWatchers, hasDebugHandler} from '../lib/common/log.js'
import type {TURNFromWorker, TURNToWorker, TURNWorkerData} from './TURNWorker.js'
import {turnWorkerCode} from './TURNWorkerCode.js'

const log = debug('webrtc/turn/workers')

/**
 * How long a thread asked to stop has to close its server, in milliseconds
 */
const STOP_TIMEOUT: number = 5000

/**
 * Whether the listeners of several threads can share a port here, the system spreading the clients among them
 * (SO_REUSEPORT): on Linux only (Bun lets the sockets of macOS share a port, but macOS gives all its datagrams to one
 * of them), when two UDP sockets, then two TCP servers, bind to one port
 * @param host The address the server listens on.
 * @internal
 */
export async function portsShareable(host: string): Promise<boolean> {
    if (process.platform !== 'linux') return false
    const sockets: Socket[] = []
    const servers: Server[] = []
    const bindUdp = (port: number): Promise<number> => new Promise((resolve: (port: number) => void, reject: (error: Error) => void): void => {
        const socket: Socket = createSocket({type: isIPv6(host) ? 'udp6' : 'udp4', reusePort: true})
        sockets.push(socket)
        socket.once('error', reject)
        socket.bind(port, host, (): void => resolve(socket.address().port))
    })
    const listenTcp = (port: number): Promise<number> => new Promise((resolve: (port: number) => void, reject: (error: Error) => void): void => {
        const server: Server = createServer()
        servers.push(server)
        server.once('error', reject)
        server.listen({port: port, host: host, reusePort: true}, (): void => resolve((server.address() as AddressInfo).port))
    })
    try {
        await bindUdp(await bindUdp(0))
        await listenTcp(await listenTcp(0))
        return true
    } catch {
        return false
    } finally {
        for (const socket of sockets) {
            try {
                socket.close()
            } catch {
                //Not bound
            }
        }
        for (const server of servers) server.close((): void => undefined)
    }
}

/**
 * The worker threads of each TURN server serving in some (for the tests and the benchmarks)
 * @internal
 */
export const turnWorkers: WeakMap<object, TURNWorkers> = new WeakMap()

interface Slot {
    readonly index: number
    worker?: Worker
    //It served once: one failing to start is not started again
    ran: boolean
}

/**
 * The worker threads of a TURN server, sharing its ports (SO_REUSEPORT) and counting their allocations together
 * @internal
 */
export class TURNWorkers {

    readonly #slots: Slot[]

    readonly #data: TURNWorkerData[]

    readonly #counts: Int32Array

    //The ports the threads bound, the first thread choosing them when the options give 0
    #port?: number

    #tlsPort?: number

    #stopping: boolean = false

    //Tells the threads whether the main thread has a debug handler
    readonly #debugging = (set: boolean): void => {
        for (const slot of this.#slots) slot.worker?.postMessage({type: 'debug', enabled: set} satisfies TURNToWorker)
    }

    /**
     * Prepare the threads.
     * @param data What each thread is started with (they share one counter of allocations).
     * @throws {Error} When the code of the threads was not built.
     */
    constructor(data: TURNWorkerData[]) {
        if (!turnWorkerCode) throw new Error('The code of the worker threads of the TURN server is not built (scripts/workers.mjs)')
        this.#data = data
        this.#counts = new Int32Array(data[0].allocations)
        this.#slots = data.map((_: TURNWorkerData, index: number): Slot => ({index: index, ran: false}))
    }

    /**
     * Start the threads: the first one, then the others on the ports it bound.
     * @throws {Error} When a thread cannot serve (a port in use).
     */
    public async start(): Promise<void> {
        debugHandlerWatchers.add(this.#debugging)
        const first: {port?: number, tlsPort?: number} = await this.#start(this.#slots[0])
        this.#port = first.port
        this.#tlsPort = first.tlsPort
        await Promise.all(this.#slots.slice(1).map((slot: Slot): Promise<unknown> => this.#start(slot)))
    }

    /**
     * Stop the threads, each closing its server.
     */
    public async stop(): Promise<void> {
        this.#stopping = true
        debugHandlerWatchers.delete(this.#debugging)
        await Promise.all(this.#slots.map(async (slot: Slot): Promise<void> => {
            const worker: Worker | undefined = slot.worker
            if (!worker) return
            let timer: NodeJS.Timeout | undefined
            await Promise.race([
                new Promise<void>((resolve: () => void): void => {
                    worker.on('message', (message: TURNFromWorker): void => {
                        if (message.type === 'stopped') resolve()
                    })
                    worker.postMessage({type: 'stop'} satisfies TURNToWorker)
                }),
                new Promise<void>((resolve: () => void): void => {
                    timer = setTimeout(resolve, STOP_TIMEOUT)
                })
            ])
            clearTimeout(timer)
            await worker.terminate()
        }))
    }

    /**
     * The allocations of all the threads.
     */
    public get allocations(): number {
        return Atomics.load(this.#counts, 0)
    }

    /**
     * The allocations of each thread.
     */
    public get threadAllocations(): number[] {
        return this.#slots.map((slot: Slot): number => Atomics.load(this.#counts, 1 + slot.index))
    }

    /**
     * The port of STUN and TURN over UDP and TCP.
     */
    public get port(): number | undefined {
        return this.#port
    }

    /**
     * The port of TURN over TLS.
     */
    public get tlsPort(): number | undefined {
        return this.#tlsPort
    }

    /**
     * Start the thread of a slot, on the ports of the first one when they are known
     * @param slot
     * @returns The ports it bound.
     */
    #start(slot: Slot): Promise<{port?: number, tlsPort?: number}> {
        const data: TURNWorkerData = this.#data[slot.index]
        const options: TURNWorkerData['options'] = this.#port === undefined ? data.options : {
            ...data.options,
            port: this.#port,
            ...data.options.tls && this.#tlsPort !== undefined ? {tls: {...data.options.tls, port: this.#tlsPort}} : {}
        }
        const worker: Worker = new Worker(turnWorkerCode, {eval: true, workerData: {...data, options: options}})
        slot.worker = worker
        if (hasDebugHandler()) worker.postMessage({type: 'debug', enabled: true} satisfies TURNToWorker)
        const ready: Promise<{port?: number, tlsPort?: number}> = new Promise((resolve: (ports: {port?: number, tlsPort?: number}) => void, reject: (error: Error) => void): void => {
            worker.on('message', (message: TURNFromWorker): void => {
                switch (message.type) {
                    case 'ready':
                        slot.ran = true
                        return resolve({port: message.port, tlsPort: message.tlsPort})
                    case 'failed':
                        return reject(new Error(message.error))
                    case 'log':
                        return debug(message.namespace)(message.message)
                }
            })
            worker.on('exit', (): void => reject(new Error('The worker thread of the TURN server stopped')))
        })
        worker.on('error', (error: Error): void => log('the worker thread %d failed: %O', slot.index, error))
        worker.on('exit', (code: number): void => {
            if (!this.#stopping) log('the worker thread %d stopped (exit code %d)', slot.index, code)
            this.#exited(slot, worker)
        })
        return ready
    }

    /**
     * A thread stopped: its allocations are gone, and it is started again, unless it never served. Most clients of the
     * other threads move too (the system spreads them over the threads left), and allocate again
     * @param slot
     * @param worker
     */
    #exited(slot: Slot, worker: Worker): void {
        if (slot.worker !== worker) return
        slot.worker = undefined
        const own: number = Atomics.exchange(this.#counts, 1 + slot.index, 0)
        Atomics.sub(this.#counts, 0, own)
        if (this.#stopping || !slot.ran) return
        this.#start(slot).catch((error: Error): void => log('the worker thread %d could not start again: %O', slot.index, error))
    }
}
