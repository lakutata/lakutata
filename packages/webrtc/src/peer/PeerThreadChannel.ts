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
 * The size below which the copies of messages and packets sent together share buffers (one allocation for many, rather
 * than one each); the side reading them copies them into buffers of their own (of the pool of Node.js), so a message
 * kept does not keep the others
 */
export const PACKED_SIZE: number = 4096

/**
 * The size of the buffers shared by the copies
 */
const CHUNK_SIZE: number = 65536

/**
 * The bytes of a message or a packet read: a buffer of its own, copied from a shared one
 * @param bytes
 */
export function readBytes(bytes: Uint8Array): Buffer {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? Buffer.from(bytes.buffer, 0, bytes.byteLength)
        : Buffer.from(bytes)
}

/**
 * The bytes of RTP packets of a connection on their way to the other side at most, in each direction: beyond, the next
 * ones are dropped, as a full UDP buffer would (the packets of the channels are not: their receive window waits)
 */
export const RTP_IN_FLIGHT: number = 2 * 1024 * 1024

/**
 * A copy of bytes in a buffer of its own, transferred to the other side (a view of a buffer would send all of it)
 * @param data
 */
function ownCopy(data: Uint8Array): {bytes: Uint8Array, transfer: ArrayBuffer[]} {
    const bytes: Uint8Array = new Uint8Array(data)
    return {bytes: bytes, transfer: [bytes.buffer as ArrayBuffer]}
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

    //The buffer the copies of small messages and packets of this sending share, and its bytes used
    #chunk?: Uint8Array

    #used: number = 0

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
     * A copy of bytes to send with this sending: in a buffer shared with the other small ones, transferred once.
     * @param data The bytes.
     * @returns The copy, and the buffer to transfer with the message holding it.
     */
    public pack(data: Uint8Array): {bytes: Uint8Array, transfer?: ArrayBuffer[]} {
        if (data.byteLength >= PACKED_SIZE) return ownCopy(data)
        let transfer: ArrayBuffer[] | undefined
        if (!this.#chunk || this.#used + data.byteLength > CHUNK_SIZE) {
            this.#chunk = new Uint8Array(CHUNK_SIZE)
            this.#used = 0
            transfer = [this.#chunk.buffer as ArrayBuffer]
        }
        const bytes: Uint8Array = this.#chunk.subarray(this.#used, this.#used + data.byteLength)
        bytes.set(data)
        this.#used += data.byteLength
        return {bytes: bytes, transfer: transfer}
    }

    /**
     * Add to the last message waiting when it is one of the same kind (the messages of a channel, the packets of a
     * track, sent together: one message for many is much cheaper to send), else send a new one; the order holds.
     * @param extend Adds to the last message waiting, when it may: whether it did.
     * @param message The new message, else.
     * @param transfer The buffers given to the other side.
     */
    public postOrExtend(extend: (last: Out) => boolean, message: () => Out, transfer?: ArrayBuffer[]): void {
        if (this.#closed) return
        const last: Out | undefined = this.#queue.at(-1) as Out | undefined
        if (!last || !extend(last)) this.#queue.push(message())
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
        //The shared buffer goes with this sending
        this.#chunk = undefined
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
