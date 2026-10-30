import {SignalingEvent} from '../protocol/SignalingProtocol.js'
import {signalingErrorOf, SignalingRequestError} from './SignalingError.js'

/**
 * How a signaling session talks to the server: requests, the events pushed by the server, and the state of the
 * connection.
 */
export interface SignalingTransport {
    /**
     * Whether the connection is up.
     */
    readonly connected: boolean

    /**
     * Send a request.
     * @param method The method (`webrtc.join`…).
     * @param params Its parameters.
     * @returns The answer.
     */
    request<Result>(method: string, params: Record<string, unknown>): Promise<Result>

    /**
     * Listen to the events pushed by the server.
     * @param listener Given the event and its payload.
     * @returns A function removing the listener.
     */
    listen(listener: (event: string, payload: unknown) => void): () => void

    /**
     * Listen to the connections and disconnections.
     * @param listener Given whether the connection is up.
     * @returns A function removing the listener.
     */
    watch(listener: (connected: boolean) => void): () => void

    /**
     * Stop: the requests in progress fail, the connection is closed when the transport opened it.
     */
    close(): void
}

/**
 * What the signaling needs of a Socket.IO client socket (`io()` of socket.io-client): the socket is given by the
 * application, its client id being its `auth.id`.
 */
export interface SocketIOSocketLike {
    /**
     * Whether it is connected.
     */
    readonly connected: boolean

    /**
     * Send an event.
     * @param event The event.
     * @param args Its arguments, the last one an acknowledgement callback.
     */
    emit(event: string, ...args: any[]): unknown

    /**
     * Add a listener.
     * @param event The event.
     * @param listener The listener.
     */
    on(event: string, listener: (...args: any[]) => void): unknown

    /**
     * Remove a listener.
     * @param event The event.
     * @param listener The listener.
     */
    off(event: string, listener?: (...args: any[]) => void): unknown
}

/**
 * What the signaling needs of a WebSocket (`WebSocket` of the browsers, of Node.js 22 and of Bun, of the package `ws`) speaking JSON-RPC to
 * the server; its client id is the `id` query parameter of its URL.
 */
export interface WebSocketLike {
    /**
     * 0 connecting, 1 open, 2 closing, 3 closed.
     */
    readonly readyState: number

    /**
     * Send a text message.
     * @param data The message.
     */
    send(data: string): void

    /**
     * Close it.
     * @param code The close code.
     * @param reason The reason.
     */
    close(code?: number, reason?: string): void

    /**
     * Add a listener: `open`, `message`, `close`, `error`.
     * @param type The event.
     * @param listener The listener.
     */
    addEventListener(type: string, listener: (event: any) => void): void

    /**
     * Remove a listener.
     * @param type The event.
     * @param listener The listener.
     */
    removeEventListener(type: string, listener: (event: any) => void): void
}

/**
 * The timers of Node.js are not to hold the process
 * @param timer
 */
export function unrefTimer<Timer>(timer: Timer): Timer {
    (timer as {unref?: () => void}).unref?.()
    return timer
}

/**
 * Set of listeners
 */
class Listeners<Args extends unknown[]> {
    readonly #set: Set<(...args: Args) => void> = new Set()

    public add(listener: (...args: Args) => void): () => void {
        this.#set.add(listener)
        return (): void => void this.#set.delete(listener)
    }

    public call(...args: Args): void {
        for (const listener of [...this.#set]) {
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

/**
 * The signaling over a Socket.IO socket: a request is the event `message`, `{method, ...params}`, answered by its
 * acknowledgement `{success, error, payload}`; the events are Socket.IO events. A request sent when the socket
 * disconnects fails at once (its answer cannot come any more); one made while it is disconnected is sent once it
 * connects again.
 */
export class SocketIOTransport implements SignalingTransport {

    readonly #socket: SocketIOSocketLike

    readonly #timeout: number

    readonly #events: Listeners<[string, unknown]> = new Listeners()

    readonly #status: Listeners<[boolean]> = new Listeners()

    readonly #handlers: [string, (...args: any[]) => void][] = []

    //The requests waiting for their answer, and whether they are sent (Socket.IO keeps the ones made while disconnected,
    //and sends them as it connects)
    readonly #pending: Map<number, {reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, sent: boolean}> = new Map()

    #nextId: number = 1

    /**
     * Use a socket.
     * @param socket The socket of the application.
     * @param timeout How long a request waits for its answer, in milliseconds.
     */
    constructor(socket: SocketIOSocketLike, timeout: number = 15000) {
        this.#socket = socket
        this.#timeout = timeout
        for (const event of Object.values(SignalingEvent)) {
            this.#handlers.push([event, (payload: unknown): void => this.#events.call(event, payload)])
        }
        this.#handlers.push(['connect', (): void => {
            this.#pending.forEach((pending: {sent: boolean}): unknown => pending.sent = true)
            this.#status.call(true)
        }])
        this.#handlers.push(['disconnect', (): void => {
            for (const [id, pending] of [...this.#pending]) {
                if (!pending.sent) continue
                this.#pending.delete(id)
                clearTimeout(pending.timer)
                pending.reject(new SignalingRequestError('The signaling is disconnected', 'E_SIGNALING_CLOSED'))
            }
            this.#status.call(false)
        }])
        for (const [event, handler] of this.#handlers) socket.on(event, handler)
    }

    public get connected(): boolean {
        return this.#socket.connected
    }

    public request<Result>(method: string, params: Record<string, unknown>): Promise<Result> {
        return new Promise<Result>((resolve: (result: Result) => void, reject: (error: Error) => void): void => {
            const id: number = this.#nextId++
            const timer: ReturnType<typeof setTimeout> = unrefTimer(setTimeout((): void => {
                this.#pending.delete(id)
                reject(new SignalingRequestError(`The request ${method} was not answered in time`, 'E_SIGNALING_TIMEOUT'))
            }, this.#timeout))
            this.#pending.set(id, {reject: reject, timer: timer, sent: this.#socket.connected})
            this.#socket.emit('message', {...params, method: method}, (response: {success?: boolean, error?: unknown, payload?: unknown} | undefined): void => {
                if (!this.#pending.delete(id)) return
                clearTimeout(timer)
                if (response?.success) return resolve(response.payload as Result)
                reject(signalingErrorOf(response?.error, `The request ${method} failed`))
            })
        })
    }

    public listen(listener: (event: string, payload: unknown) => void): () => void {
        return this.#events.add(listener)
    }

    public watch(listener: (connected: boolean) => void): () => void {
        return this.#status.add(listener)
    }

    public close(): void {
        for (const [event, handler] of this.#handlers) this.#socket.off(event, handler)
    }
}

/**
 * A request waiting for its answer
 */
type PendingRequest = {
    resolve: (result: any) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

/**
 * The signaling over JSON-RPC 2.0 on a WebSocket: the requests are JSON-RPC requests, the events are notifications whose
 * `params` hold the payload. Given a function creating the WebSocket, it reconnects after a disconnection, waiting 1
 * second, then twice as long each time, 30 seconds at most. A request sent on a socket that closes fails at once (its
 * answer cannot come any more); one made while the socket is not open is sent once it opens.
 */
export class JSONRPCTransport implements SignalingTransport {

    readonly #factory?: () => WebSocketLike

    readonly #timeout: number

    readonly #events: Listeners<[string, unknown]> = new Listeners()

    readonly #status: Listeners<[boolean]> = new Listeners()

    readonly #pending: Map<number, PendingRequest> = new Map()

    //The requests sent once the socket opens
    readonly #queue: [number, string][] = []

    //The requests sent on the socket, waiting for their answer
    readonly #sent: Set<number> = new Set()

    #socket: WebSocketLike

    #nextId: number = 1

    #closed: boolean = false

    #delay: number = 1000

    #reconnectTimer?: ReturnType<typeof setTimeout>

    /**
     * Use a WebSocket.
     * @param socket The WebSocket, or a function creating one (to reconnect).
     * @param timeout How long a request waits for its answer, in milliseconds.
     */
    constructor(socket: WebSocketLike | (() => WebSocketLike), timeout: number = 15000) {
        this.#timeout = timeout
        if (typeof socket === 'function') {
            this.#factory = socket
            this.#attach(socket())
        } else {
            this.#attach(socket)
        }
    }

    public get connected(): boolean {
        return this.#socket.readyState === 1
    }

    public request<Result>(method: string, params: Record<string, unknown>): Promise<Result> {
        if (this.#closed) return Promise.reject(new SignalingRequestError('The signaling is closed', 'E_SIGNALING_CLOSED'))
        return new Promise<Result>((resolve: (result: Result) => void, reject: (error: Error) => void): void => {
            const id: number = this.#nextId++
            const timer: ReturnType<typeof setTimeout> = unrefTimer(setTimeout((): void => {
                this.#pending.delete(id)
                reject(new SignalingRequestError(`The request ${method} was not answered in time`, 'E_SIGNALING_TIMEOUT'))
            }, this.#timeout))
            this.#pending.set(id, {resolve: resolve, reject: reject, timer: timer})
            const message: string = JSON.stringify({jsonrpc: '2.0', id: id, method: method, params: params})
            if (this.connected) {
                this.#socket.send(message)
                this.#sent.add(id)
            } else if (this.#factory || this.#socket.readyState === 0) {
                this.#queue.push([id, message])
            } else {
                this.#settle(id, new SignalingRequestError('The signaling is disconnected', 'E_SIGNALING_CLOSED'))
            }
        })
    }

    public listen(listener: (event: string, payload: unknown) => void): () => void {
        return this.#events.add(listener)
    }

    public watch(listener: (connected: boolean) => void): () => void {
        return this.#status.add(listener)
    }

    public close(): void {
        if (this.#closed) return
        this.#closed = true
        clearTimeout(this.#reconnectTimer)
        this.#queue.length = 0
        for (const id of [...this.#pending.keys()]) this.#settle(id, new SignalingRequestError('The signaling is closed', 'E_SIGNALING_CLOSED'))
        //A socket given by the application stays open: only the ones created by its function are closed
        if (this.#factory && this.#socket.readyState < 2) this.#socket.close(1000)
    }

    /**
     * Answer a pending request with an error, or with its result
     * @param id
     * @param error
     * @param result
     */
    #settle(id: number, error?: Error, result?: unknown): void {
        const pending: PendingRequest | undefined = this.#pending.get(id)
        if (!pending) return
        this.#pending.delete(id)
        this.#sent.delete(id)
        clearTimeout(pending.timer)
        if (error) {
            pending.reject(error)
        } else {
            pending.resolve(result)
        }
    }

    /**
     * Listen to a socket
     * @param socket
     */
    #attach(socket: WebSocketLike): void {
        this.#socket = socket
        const onOpen = (): void => {
            this.#delay = 1000
            for (const [id, message] of this.#queue.splice(0)) {
                //Not sent when it failed meanwhile (its time ran out)
                if (!this.#pending.has(id)) continue
                socket.send(message)
                this.#sent.add(id)
            }
            this.#status.call(true)
        }
        const onMessage = (event: {data: unknown}): void => this.#receive(event.data)
        const onClose = (): void => {
            socket.removeEventListener('open', onOpen)
            socket.removeEventListener('message', onMessage)
            socket.removeEventListener('close', onClose)
            if (this.#closed) return
            //The requests sent cannot be answered any more; without a function to reconnect, the queued ones neither
            for (const id of this.#factory ? [...this.#sent] : [...this.#pending.keys()]) this.#settle(id, new SignalingRequestError('The signaling is disconnected', 'E_SIGNALING_CLOSED'))
            this.#status.call(false)
            if (!this.#factory) return
            this.#reconnectTimer = unrefTimer(setTimeout((): void => {
                if (!this.#closed) this.#attach(this.#factory!())
            }, this.#delay))
            this.#delay = Math.min(this.#delay * 2, 30000)
        }
        socket.addEventListener('open', onOpen)
        socket.addEventListener('message', onMessage)
        socket.addEventListener('close', onClose)
        if (socket.readyState === 1) onOpen()
    }

    /**
     * A message from the server: an answer, or a notification
     * @param data
     */
    #receive(data: unknown): void {
        let message: any
        try {
            message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer))
        } catch {
            return
        }
        for (const item of Array.isArray(message) ? message : [message]) {
            if (!item || typeof item !== 'object') continue
            if (typeof item.method === 'string' && item.id === undefined) {
                this.#events.call(item.method, Array.isArray(item.params) ? item.params[0] : item.params)
            } else if (typeof item.id === 'number') {
                if (item.error) {
                    this.#settle(item.id, signalingErrorOf(item.error, 'The signaling request failed'))
                } else {
                    this.#settle(item.id, undefined, item.result)
                }
            }
        }
    }
}
