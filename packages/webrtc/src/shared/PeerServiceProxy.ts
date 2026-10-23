import {ChunkedChannel, type ChunkableChannel} from './ChunkedChannel.js'

/**
 * The error of a call of a {@link PeerServiceProxy}: the error the action threw (its `errno`, the whole error object
 * as `data`), the JSON-RPC error of the request (`code`), `E_PEER_SERVICE_TIMEOUT` and `E_PEER_SERVICE_CLOSED` for
 * the calls without a response, or `E_PEER_SERVICE_TOO_LARGE` for a request over the size limit, not sent.
 * @example
 * ```typescript
 * import {PeerServiceError, type PeerServiceProxy} from '@lakutata/webrtc/client'
 *
 * declare const device: PeerServiceProxy
 * try {
 *     await device.invoke({method: 'door.open'})
 * } catch (error) {
 *     if (error instanceof PeerServiceError && error.errno === 'E_ACCESS_DENY') console.log('not allowed to open the door')
 * }
 * ```
 */
export class PeerServiceError extends Error {

    /**
     * The `errno` of the action's error (`E_ACCESS_DENY`, `E_INVALID_VALUE`…), the JSON-RPC error code when the error
     * has none, or `E_PEER_SERVICE_TIMEOUT`, `E_PEER_SERVICE_CLOSED` and `E_PEER_SERVICE_TOO_LARGE`.
     */
    public readonly errno: string | number

    /**
     * The JSON-RPC error code of the response (`-32601` when no action matches, `-32602` for an invalid input…);
     * `undefined` for the calls without a response.
     */
    public readonly code?: number

    /**
     * The error the application sent, as it sent it: the properties of the action's error.
     */
    public readonly data?: unknown

    /**
     * Create the error.
     * @param message The message.
     * @param errno The error number.
     * @param code The JSON-RPC error code.
     * @param data The error the application sent.
     */
    constructor(message: string, errno: string | number, code?: number, data?: unknown) {
        super(message)
        this.name = 'PeerServiceError'
        this.errno = errno
        this.code = code
        this.data = data
    }
}

/**
 * The options of a {@link PeerServiceProxy}.
 */
export interface PeerServiceProxyOptions {
    /**
     * The field of the input sent as the request's method: the `methodField` of the application's
     * `webrtcServiceEntrypoint`.
     * @default 'method'
     */
    methodField?: string
    /**
     * The size of a response or an event received at most, in bytes: a larger one is dropped (its call then times out).
     * @default 67108864 (64 MiB)
     */
    maxMessageSize?: number
    /**
     * The size of a request sent at most, in bytes, as JSON: a larger call fails at once with
     * `E_PEER_SERVICE_TOO_LARGE`, since the application drops the requests over its `limit` without knowing which call
     * they were. The same as the default `limit` of `webrtcServiceEntrypoint`.
     * @default 10485760 (10 MiB)
     */
    maxRequestSize?: number
}

/**
 * A call waiting for its response
 */
type PendingCall = {
    resolve: (result: unknown) => void
    reject: (error: PeerServiceError) => void
    timer: ReturnType<typeof setTimeout>
}

/**
 * A message of JSON-RPC 2.0 received: a response or a notification
 */
type IncomingMessage = {
    id?: string | number | null
    result?: unknown
    error?: {code?: unknown, message?: unknown, data?: unknown}
    method?: unknown
    params?: unknown
}

/**
 * The service actions of another member, called through a data channel to it: the member is a lakutata application
 * serving its service actions with `webrtcServiceEntrypoint` (its controllers' `@ServiceAction` methods). Create the
 * channel with the label the application serves (`'service'` by default); the calls wait for it to open. A call is a
 * request of JSON-RPC 2.0 whose method is the input's `methodField`, and the events the application pushes to this
 * member (`Entrypoint.notify()` with the member's id, `Entrypoint.broadcast()`) reach the listeners added with `on`.
 * The messages are cut into chunks as `ChunkedChannel` does, so their size is not limited by the data channel.
 *
 * The same in the browsers (`@lakutata/webrtc/client`) and in Node.js (`@lakutata/webrtc`).
 * @example
 * ```typescript
 * import {PeerServiceProxy, type Peer} from '@lakutata/webrtc/client'
 *
 * declare const peer: Peer
 * //The device's action declared with @ServiceAction({method: 'door.status'})
 * const device: PeerServiceProxy = new PeerServiceProxy(peer.createDataChannel('service'))
 * device.on('opened', (by: string): void => console.log(`opened by ${by}`))
 * const status: {open: boolean} = await device.invoke({method: 'door.status', door: 'front'})
 * ```
 */
export class PeerServiceProxy {

    readonly #channel: ChunkableChannel

    readonly #chunked: ChunkedChannel

    readonly #methodField: string

    readonly #maxRequestSize: number

    readonly #pending: Map<number, PendingCall> = new Map()

    readonly #listeners: Map<string, Set<(...args: any[]) => void>> = new Map()

    readonly #opened: Promise<void>

    #nextId: number = 1

    #closed: boolean = false

    /**
     * Call the service actions of a member through a data channel to it.
     * @param channel The data channel: an `RTCDataChannel` in the browsers, a `PeerChannel` in Node.js; ordered and
     * reliable (the default).
     * @param options The method field, the size of a message received at most.
     * @throws {TypeError} When the channel is not ordered.
     */
    constructor(channel: ChunkableChannel, options: PeerServiceProxyOptions = {}) {
        this.#channel = channel
        this.#methodField = options.methodField ?? 'method'
        this.#maxRequestSize = options.maxRequestSize ?? 10 * 1024 * 1024
        this.#chunked = new ChunkedChannel(channel, {...options.maxMessageSize === undefined ? {} : {maxMessageSize: options.maxMessageSize}})
        this.#chunked.on('message', (data: string | Uint8Array): void => this.#receive(data))
        this.#opened = new Promise<void>((resolve: () => void): void => {
            if (channel.readyState === 'open') return resolve()
            const opened = (): void => {
                channel.removeEventListener('open', opened)
                resolve()
            }
            channel.addEventListener('open', opened)
        })
        const closed = (): void => {
            channel.removeEventListener('close', closed)
            this.#close()
        }
        channel.addEventListener('close', closed)
        if (channel.readyState === 'closed') this.#close()
    }

    /**
     * The data channel.
     */
    public get channel(): ChunkableChannel {
        return this.#channel
    }

    /**
     * Call a service action of the member.
     * @param input The action's pattern and input: its `methodField` (`method` by default) is sent as the request's
     * method, the rest as its params.
     * @param timeout How long to wait for the response, in milliseconds (the time to open the channel included).
     * @returns The action's result.
     * @throws {PeerServiceError} The error of the action or of the request, `E_PEER_SERVICE_TIMEOUT` and
     * `E_PEER_SERVICE_CLOSED` when no response came, or `E_PEER_SERVICE_TOO_LARGE` when the request is over
     * `maxRequestSize` (it is not sent).
     * @throws {TypeError} When the input's `methodField` is not a string.
     * @example
     * ```typescript
     * import type {PeerServiceProxy} from '@lakutata/webrtc/client'
     *
     * declare const device: PeerServiceProxy
     * //The request {"jsonrpc": "2.0", "id": 1, "method": "light.set", "params": {"room": "hall", "on": true}}
     * await device.invoke({method: 'light.set', room: 'hall', on: true}, 5000)
     * ```
     */
    public invoke<T = any>(input: Record<string, unknown>, timeout: number = 10 * 60 * 1000): Promise<T> {
        const {[this.#methodField]: method, ...params} = input
        if (typeof method !== 'string') throw new TypeError(`The input has no method: its field ${this.#methodField} is not a string`)
        if (this.#closed) return Promise.reject(new PeerServiceError('The channel is closed', 'E_PEER_SERVICE_CLOSED'))
        const id: number = this.#nextId++
        const request: string = JSON.stringify({jsonrpc: '2.0', id: id, method: method, params: params})
        const size: number = new TextEncoder().encode(request).byteLength
        if (size > this.#maxRequestSize) return Promise.reject(new PeerServiceError(`The request of ${method} is ${size} bytes, over ${this.#maxRequestSize}`, 'E_PEER_SERVICE_TOO_LARGE'))
        return new Promise<T>((resolve: (result: T) => void, reject: (error: PeerServiceError) => void): void => {
            const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
                this.#pending.delete(id)
                reject(new PeerServiceError(`No response to ${method} in ${timeout} ms`, 'E_PEER_SERVICE_TIMEOUT'))
            }, timeout)
            this.#pending.set(id, {resolve: resolve as (result: unknown) => void, reject: reject, timer: timer})
            this.#opened.then((): Promise<void> => {
                if (!this.#pending.has(id)) return Promise.resolve()
                return this.#chunked.send(request)
            }).catch((): void => this.#settle(id, undefined, new PeerServiceError('The channel is closed', 'E_PEER_SERVICE_CLOSED')))
        })
    }

    /**
     * Listen to an event the application pushes to this member.
     * @param event The event's name.
     * @param listener Called with the event's arguments.
     * @returns The proxy.
     * @example
     * ```typescript
     * import type {PeerServiceProxy} from '@lakutata/webrtc/client'
     *
     * declare const device: PeerServiceProxy
     * //entrypoint.notify(<this member's id>, 'progress', 50) in the application
     * device.on('progress', (percent: number): void => console.log(`${percent}%`))
     * ```
     */
    public on(event: string, listener: (...args: any[]) => void): this {
        let listeners: Set<(...args: any[]) => void> | undefined = this.#listeners.get(event)
        if (!listeners) {
            listeners = new Set()
            this.#listeners.set(event, listeners)
        }
        listeners.add(listener)
        return this
    }

    /**
     * Listen to the next push of an event only.
     * @param event The event's name.
     * @param listener Called with the event's arguments.
     * @returns The proxy.
     * @example
     * ```typescript
     * import type {PeerServiceProxy} from '@lakutata/webrtc/client'
     *
     * declare const device: PeerServiceProxy
     * device.once('ready', (): void => console.log('the device is ready'))
     * ```
     */
    public once(event: string, listener: (...args: any[]) => void): this {
        const wrapper = (...args: any[]): void => {
            this.off(event, wrapper)
            listener(...args)
        }
        return this.on(event, wrapper)
    }

    /**
     * Remove a listener of an event, or all of them.
     * @param event The event's name.
     * @param listener The listener; all the listeners of the event without it.
     * @returns The proxy.
     * @example
     * ```typescript
     * import type {PeerServiceProxy} from '@lakutata/webrtc/client'
     *
     * declare const device: PeerServiceProxy
     * device.off('progress')
     * ```
     */
    public off(event: string, listener?: (...args: any[]) => void): this {
        if (listener) {
            this.#listeners.get(event)?.delete(listener)
        } else {
            this.#listeners.delete(event)
        }
        return this
    }

    /**
     * Close the data channel: the calls waiting for their response fail with `E_PEER_SERVICE_CLOSED`.
     * @example
     * ```typescript
     * import type {PeerServiceProxy} from '@lakutata/webrtc/client'
     *
     * declare const device: PeerServiceProxy
     * device.close()
     * ```
     */
    public close(): void {
        this.#chunked.close()
        this.#close()
    }

    /**
     * The channel is closed: the calls fail
     */
    #close(): void {
        if (this.#closed) return
        this.#closed = true
        for (const id of [...this.#pending.keys()]) this.#settle(id, undefined, new PeerServiceError('The channel is closed', 'E_PEER_SERVICE_CLOSED'))
    }

    /**
     * End a call
     * @param id
     * @param result
     * @param error
     */
    #settle(id: number, result: unknown, error?: PeerServiceError): void {
        const call: PendingCall | undefined = this.#pending.get(id)
        if (!call) return
        this.#pending.delete(id)
        clearTimeout(call.timer)
        if (error) return call.reject(error)
        call.resolve(result)
    }

    /**
     * A message of the application: responses, events
     * @param data
     */
    #receive(data: string | Uint8Array): void {
        if (typeof data !== 'string') return
        let parsed: unknown
        try {
            parsed = JSON.parse(data)
        } catch {
            return
        }
        for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
            if (!entry || typeof entry !== 'object') continue
            const {id, result, error, method, params} = entry as IncomingMessage
            if (typeof method === 'string' && id === undefined) {
                this.#event(method, Array.isArray(params) ? params : params === undefined ? [] : [params])
            } else if (typeof id === 'number') {
                if (!error) {
                    this.#settle(id, result)
                    continue
                }
                const remote: Record<string, unknown> = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : {}
                const message: unknown = remote.errMsg ?? remote.message ?? error.message
                const code: number | undefined = typeof error.code === 'number' ? error.code : undefined
                const errno: unknown = remote.errno ?? code ?? 'E_PEER_SERVICE'
                this.#settle(id, undefined, new PeerServiceError(typeof message === 'string' ? message : 'The call failed', errno as string | number, code, error.data))
            }
        }
    }

    /**
     * Call the listeners of an event; a listener throwing is reported as an uncaught error and does not stop the others
     * @param event
     * @param args
     */
    #event(event: string, args: unknown[]): void {
        for (const listener of [...this.#listeners.get(event) ?? []]) {
            try {
                listener(...args)
            } catch (error) {
                queueMicrotask((): never => {
                    throw error
                })
            }
        }
    }
}
