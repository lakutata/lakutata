import {debug} from '../lib/common/log.js'

const log = debug('webrtc/peer/threads')

/**
 * What a side posts to and reads from: the parent port of a worker thread, or the worker
 */
export interface PeerThreadPort {
    postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void
    on(event: 'message', listener: (value: unknown) => void): unknown
}

/**
 * An error sent to the other side: its class is lost, its name and message are kept
 */
export interface PeerThreadError {
    readonly name: string
    readonly message: string
}

type Item = {type: string, request?: number, reply?: number, result?: unknown, error?: PeerThreadError}

/**
 * The error of the other side, with its name (InvalidStateError, OperationError…)
 * @param error
 */
export function threadErrorOf(error: PeerThreadError): Error {
    return Object.assign(new Error(error.message), {name: error.name})
}

/**
 * An error, as sent to the other side
 * @param error
 */
export function sentError(error: unknown): PeerThreadError {
    return error instanceof Error ? {name: error.name, message: error.message} : {name: 'Error', message: String(error)}
}

/**
 * The messages of a side to the other, sent together once per turn of the event loop and in their order (requests,
 * replies, events, data), with the buffers given transferred. A request is answered by the result of its handler, or
 * by its error
 */
export class PeerThreadChannel<Out extends {type: string}, In extends {type: string}> {

    readonly #port: PeerThreadPort

    readonly #handle: (message: In) => unknown

    readonly #pending: Map<number, {resolve: (result: unknown) => void, reject: (error: Error) => void}> = new Map()

    //Called before each sending, to add what a turn of the event loop changed (the amounts buffered)
    readonly #flushing: Set<() => void> = new Set()

    #queue: unknown[] = []

    #transfer: ArrayBuffer[] = []

    #scheduled: boolean = false

    #next: number = 1

    #closed?: Error

    /**
     * Read the messages of a port.
     * @param port The port.
     * @param handle Handles a message; the result of a request (or its promise) is its reply.
     */
    constructor(port: PeerThreadPort, handle: (message: In) => unknown) {
        this.#port = port
        this.#handle = handle
        port.on('message', (batch: unknown): void => {
            if (!Array.isArray(batch)) return
            for (const item of batch as Item[]) this.#read(item)
        })
    }

    /**
     * Whether the channel is closed.
     */
    public get closed(): boolean {
        return !!this.#closed
    }

    /**
     * Send a message that is not answered.
     * @param message The message.
     * @param transfer The buffers given to the other side (allocated by the sender for it: never one shared).
     */
    public post(message: Out, transfer?: ArrayBuffer[]): void {
        if (this.#closed) return
        this.#queue.push(message)
        if (transfer) this.#transfer.push(...transfer)
        this.#schedule()
    }

    /**
     * Send a request, and wait for its reply.
     * @param message The request.
     * @param transfer The buffers given to the other side.
     * @returns Its result.
     * @throws {Error} The error of the other side, or the one the channel closed with.
     */
    public request<Result>(message: Out, transfer?: ArrayBuffer[]): Promise<Result> {
        if (this.#closed) return Promise.reject(this.#closed)
        const request: number = this.#next++
        return new Promise((resolve: (result: Result) => void, reject: (error: Error) => void): void => {
            this.#pending.set(request, {resolve: resolve as (result: unknown) => void, reject: reject})
            this.post({...message, request: request}, transfer)
        })
    }

    /**
     * Call a function before each sending.
     * @param callback The function: it posts what changed.
     */
    public beforeSending(callback: () => void): void {
        this.#flushing.add(callback)
    }

    /**
     * Send at the end of this turn of the event loop, even with no message waiting: what the callbacks given to
     * beforeSending post.
     */
    public schedule(): void {
        if (!this.#closed) this.#schedule()
    }

    /**
     * Send what is waiting now, without waiting for the end of the turn of the event loop.
     */
    public flush(): void {
        this.#scheduled = false
        if (this.#closed) return
        for (const callback of this.#flushing) callback()
        if (!this.#queue.length) return
        const queue: unknown[] = this.#queue
        const transfer: ArrayBuffer[] = this.#transfer
        this.#queue = []
        this.#transfer = []
        try {
            this.#port.postMessage(queue, transfer)
        } catch (error) {
            //A value that cannot be sent: the requests among the messages fail, the others are lost
            log('a batch could not be sent: %O', error)
            for (const item of queue as Item[]) if (item.request !== undefined) this.#reply(item.request, undefined, error)
        }
    }

    /**
     * Close the channel: the requests waiting and the next ones fail, nothing is sent any more.
     * @param error Their error.
     */
    public close(error: Error): void {
        this.#closed ??= error
        this.#queue = []
        this.#transfer = []
        for (const {reject} of this.#pending.values()) reject(error)
        this.#pending.clear()
    }

    /**
     * Send at the end of the turn of the event loop
     */
    #schedule(): void {
        if (this.#scheduled) return
        this.#scheduled = true
        setImmediate((): void => this.flush())
    }

    /**
     * Read a message: a reply, a request, or a message not answered. A handler throwing does not stop the others
     * @param item
     */
    #read(item: Item): void {
        if (item.type === 'reply') {
            const pending = this.#pending.get(item.reply!)
            this.#pending.delete(item.reply!)
            if (item.error === undefined) pending?.resolve(item.result)
            else pending?.reject(threadErrorOf(item.error))
            return
        }
        const request: number | undefined = item.request
        let result: unknown
        try {
            result = this.#handle(item as unknown as In)
        } catch (error) {
            if (request === undefined) log('a message failed: %O', error)
            else this.#reply(request, undefined, error)
            return
        }
        if (request === undefined) {
            if (result instanceof Promise) result.catch((error: unknown): void => log('a message failed: %O', error))
            return
        }
        if (result instanceof Promise) result.then((value: unknown): void => this.#reply(request, value), (error: unknown): void => this.#reply(request, undefined, error))
        else this.#reply(request, result)
    }

    /**
     * Answer a request
     * @param request
     * @param result
     * @param error
     */
    #reply(request: number, result: unknown, error?: unknown): void {
        if (this.#closed) return
        this.#queue.push(error === undefined ? {type: 'reply', reply: request, result: result} : {type: 'reply', reply: request, error: sentError(error)})
        this.#schedule()
    }
}
