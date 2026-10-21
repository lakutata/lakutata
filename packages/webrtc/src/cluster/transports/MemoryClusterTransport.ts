import type {ClusterTransport} from './ClusterTransport.js'

/**
 * The subscribers of each subject in the process
 */
const subscribers: Map<string, Set<(data: Uint8Array) => void>> = new Map()

/**
 * The bus in the memory of the process: the clusters of the same prefix in one process (the applications of a test)
 */
export class MemoryClusterTransport implements ClusterTransport {

    public readonly maxPayload: number = Number.POSITIVE_INFINITY

    readonly #subscriptions: [string, (data: Uint8Array) => void][] = []

    #closed: boolean = false

    public async connect(): Promise<void> {
        this.#closed = false
    }

    public publish(subject: string, data: Uint8Array): void {
        if (this.#closed) return
        const copy: Uint8Array = Uint8Array.from(data)
        //Delivered later, in the order published, as a server would
        setImmediate((): void => subscribers.get(subject)?.forEach((handler: (data: Uint8Array) => void): void => handler(copy)))
    }

    public async subscribe(subject: string, handler: (data: Uint8Array) => void): Promise<void> {
        if (!subscribers.has(subject)) subscribers.set(subject, new Set())
        subscribers.get(subject)!.add(handler)
        this.#subscriptions.push([subject, handler])
    }

    public onReconnect(): void {
        //Never lost
    }

    public async close(): Promise<void> {
        this.#closed = true
        for (const [subject, handler] of this.#subscriptions.splice(0)) {
            subscribers.get(subject)?.delete(handler)
            if (!subscribers.get(subject)?.size) subscribers.delete(subject)
        }
    }
}
