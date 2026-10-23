import {format} from 'node:util'
import {parentPort, workerData} from 'node:worker_threads'
import {setDebugHandler} from '../lib/common/log.js'
import {NodeTurnServer, type NodeTurnServerOptions} from '../lib/turn/node/turnServer.js'
import {turnPasswordIfValid} from './TURNCredentials.js'

/**
 * What a worker thread of the TURN server is started with
 */
export interface TURNWorkerData {
    //Its index
    readonly thread: number
    //The options of its server but the credentials, its share of the relay ports among them, maxAllocations counting
    //the allocations of all the threads
    readonly options: Omit<NodeTurnServerOptions, 'getPassword' | 'allocationGate' | 'reusePort'>
    readonly users: Record<string, string>
    readonly secret: string
    //The allocations of all the threads (index 0), then of each (index 1 + its index), counted together
    readonly allocations: SharedArrayBuffer
}

/**
 * The messages of the main thread to a worker thread of the TURN server
 */
export type TURNToWorker = {type: 'stop'} | {type: 'debug', enabled: boolean}

/**
 * The messages of a worker thread of the TURN server to the main thread
 */
export type TURNFromWorker =
    {type: 'ready', port?: number, tlsPort?: number}
    | {type: 'failed', error: string}
    | {type: 'stopped'}
    | {type: 'log', namespace: string, message: string}

/**
 * Serve TURN in a worker thread: a server whose listeners share their ports with the ones of the other threads (the
 * system keeps each client on one), the allocations counted with theirs against maxAllocations
 */
export function runTURNWorker(): void {
    if (!parentPort) throw new Error('The TURN server serves in a worker thread only')
    const port: NonNullable<typeof parentPort> = parentPort
    const data: TURNWorkerData = workerData as TURNWorkerData
    const counts: Int32Array = new Int32Array(data.allocations)
    const own: number = 1 + data.thread
    const maxAllocations: number = data.options.maxAllocations ?? Infinity
    const server: NodeTurnServer = new NodeTurnServer({
        ...data.options,
        reusePort: true,
        getPassword: (username: string): string | undefined => data.users[username] ?? turnPasswordIfValid(data.secret, username),
        allocationGate: {
            reserve: (): boolean => {
                if (Atomics.add(counts, 0, 1) < maxAllocations) {
                    Atomics.add(counts, own, 1)
                    return true
                }
                Atomics.sub(counts, 0, 1)
                return false
            },
            release: (): void => {
                Atomics.sub(counts, 0, 1)
                Atomics.sub(counts, own, 1)
            }
        }
    })
    const post = (message: TURNFromWorker): void => port.postMessage(message)
    port.on('message', (message: TURNToWorker): void => {
        if (message.type === 'debug') {
            //The debug messages go to the handler of the main thread while it has one
            setDebugHandler(message.enabled
                ? (namespace: string, args: unknown[]): void => post({type: 'log', namespace: namespace, message: `[thread ${data.thread}] ${format(...args)}`})
                : undefined)
            return
        }
        server.close().then((): void => post({type: 'stopped'}), (): void => post({type: 'stopped'}))
    })
    server.listen().then(
        (): void => post({type: 'ready', port: server.address?.[1], tlsPort: server.tlsAddress?.[1]}),
        (error: unknown): void => post({type: 'failed', error: error instanceof Error ? error.message : String(error)})
    )
}
