import {randomUUID} from 'node:crypto'
import {type IncomingMessage, request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {type ActionPattern, Component, type ComponentOptionsBuilder, DTO} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {ServiceUnavailableException} from '../../exceptions/ServiceUnavailableException.js'

/**
 * The options of an {@link HTTPServiceProxy}, given to {@link buildHTTPServiceProxy}.
 */
export type BuildHTTPServiceProxyOptions = {
    /**
     * The address of the service: the URL of its `httpServiceEntrypoint`, with the adapter's `path`
     * (`http://inventory:3000/`, `https://orders.internal/rpc`).
     */
    readonly url: string
    /**
     * The headers sent with each call and with the event stream, such as `{Authorization: 'Bearer <token>'}`.
     */
    readonly headers?: Record<string, string>
    /**
     * The client's id, sent as the `id` header of the calls and the `id` query parameter of the event stream: the
     * service's `ServiceContext.clientId`, which `Entrypoint.notify()` pushes events to. Give a stable one to receive
     * the events across restarts. At most 200 characters.
     * @default a random UUID
     */
    readonly clientId?: string
    /**
     * The delay, in milliseconds, before the event stream is opened again once it ended or failed (the service
     * restarted, unreachable). A non-negative integer.
     * @default 1000
     */
    readonly reconnectDelay?: number
}

/**
 * Build the component options of an {@link HTTPServiceProxy}, to register it in the `components` of an application.
 * @param options The service's address, and the headers, client id and reconnection delay.
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildHTTPServiceProxy, type HTTPServiceProxy} from 'lakutata/com/entrypoint'
 *
 * Application
 *     .run(() => ({
 *         id: 'shop.app',
 *         name: 'Shop',
 *         components: {
 *             inventory: buildHTTPServiceProxy({url: 'http://inventory.internal:3000/'}),
 *             //With a token, and a stable client id to receive the events of the service
 *             orders: buildHTTPServiceProxy({
 *                 url: 'https://orders.internal/rpc',
 *                 headers: {Authorization: `Bearer ${process.env.ORDERS_TOKEN}`},
 *                 clientId: 'shop-1'
 *             })
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const inventory: HTTPServiceProxy = await app.getObject<HTTPServiceProxy>('inventory')
 *         console.log(await inventory.invoke({cmd: 'stock.get', product: 'lamp'}))
 *     })
 * ```
 */
export const buildHTTPServiceProxy: ComponentOptionsBuilder<BuildHTTPServiceProxyOptions> = (options: BuildHTTPServiceProxyOptions) => {
    return {
        class: HTTPServiceProxy,
        url: options.url,
        headers: options.headers,
        clientId: options.clientId,
        reconnectDelay: options.reconnectDelay
    }
}

/**
 * Whether a body is a service response
 * @param body
 */
function isServiceResponse(body: unknown): body is ServiceResponse {
    return !!body && typeof body === 'object' && typeof (body as ServiceResponse).success === 'boolean'
}

/**
 * The reason a request failed: the network error under the "fetch failed" of fetch(), each of them when several
 * addresses were tried (localhost: ::1, then 127.0.0.1)
 * @param error
 */
function reasonOf(error: unknown): string {
    const cause: unknown = (error as Error)?.cause ?? error
    if (cause instanceof AggregateError && cause.errors.length) return cause.errors.map((each: unknown): string => (each as Error)?.message ?? String(each)).join(', ')
    return (cause as Error)?.message || (error as Error)?.message || String(error)
}

/**
 * The response of a request: its status and its body, read once
 */
type HTTPResponse = {
    status: number
    body: AsyncIterable<Uint8Array>
    /**
     * Give up the body unread
     */
    cancel: () => Promise<void>
}

/**
 * Whether fetch() can be used: the fetch of Node.js (undici) compiles its parser to WebAssembly once called. On a
 * runtime without WebAssembly (V8 run --jitless: Node.js on iOS and on HarmonyOS), it ends Node.js 18 at its first call
 * (an error no catch receives), and Node.js 24 fails the call. The requests go through node:http then
 */
function fetchUsable(): boolean {
    return typeof fetch === 'function' && (globalThis as Record<string, unknown>).WebAssembly !== undefined
}

/**
 * The chunks of a body of fetch()
 * @param stream
 */
async function* chunksOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader()
    try {
        for (; ;) {
            const {value, done} = await reader.read()
            if (done) return
            yield value
        }
    } finally {
        reader.releaseLock()
    }
}

/**
 * Send a request: with fetch(), else with node:http or node:https (a runtime without WebAssembly)
 * @param url
 * @param init its method, its headers, its body and the signal aborting it
 */
async function send(url: string, init: { method?: string, headers: Record<string, string>, body?: string, signal: AbortSignal }): Promise<HTTPResponse> {
    if (fetchUsable()) {
        const response: Response = await fetch(url, init)
        return {
            status: response.status,
            body: response.body ? chunksOf(response.body) : (async function* (): AsyncGenerator<Uint8Array> {})(),
            cancel: async (): Promise<void> => void await response.body?.cancel()
        }
    }
    const headers: Record<string, string | number> = init.body === undefined ? init.headers : {...init.headers, 'Content-Length': Buffer.byteLength(init.body)}
    const response: IncomingMessage = await new Promise((resolve: (response: IncomingMessage) => void, reject: (error: Error) => void): void => {
        (url.startsWith('https:') ? httpsRequest : httpRequest)(url, {method: init.method ?? 'GET', headers: headers, signal: init.signal}, resolve)
            .once('error', reject)
            .end(init.body)
    })
    return {
        status: response.statusCode ?? 0,
        body: response,
        cancel: async (): Promise<void> => void response.destroy()
    }
}

/**
 * The text of a body
 * @param body
 */
async function textOf(body: AsyncIterable<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder()
    let text: string = ''
    for await (const chunk of body) text += decoder.decode(chunk, {stream: true})
    return text + decoder.decode()
}

/**
 * The events of a stream of Server-Sent Events: their names and their data, the comments skipped
 * @param stream
 */
async function* serverSentEvents(stream: AsyncIterable<Uint8Array>): AsyncGenerator<{ event: string, data: string }> {
    const decoder = new TextDecoder()
    let buffer: string = ''
    let event: string = 'message'
    let data: string[] = []
    for await (const chunk of stream) {
        buffer += decoder.decode(chunk, {stream: true})
        //The complete lines; the last one may be cut by the chunk
        const lines: string[] = buffer.split('\n')
        buffer = lines.pop()!
        for (const read of lines) {
            const line: string = read.endsWith('\r') ? read.slice(0, -1) : read
            //A blank line ends the event
            if (!line) {
                if (data.length) yield {event: event, data: data.join('\n')}
                event = 'message'
                data = []
                continue
            }
            if (line.startsWith(':')) continue
            const colon: number = line.indexOf(':')
            const field: string = colon < 0 ? line : line.slice(0, colon)
            const value: string = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
            if (field === 'event') event = value
            else if (field === 'data') data.push(value)
        }
    }
}

/**
 * The client of a lakutata service served over HTTP by `httpServiceEntrypoint`: it invokes the service's actions by
 * their patterns and listens to the events the service pushes to it. It is a component (a singleton), registered with
 * {@link buildHTTPServiceProxy}; it needs no package (it uses the `fetch()` of Node.js, and `node:http` on a runtime
 * without WebAssembly, where calling `fetch()` ends Node.js: Node.js on iOS and on HarmonyOS), and its event stream is
 * opened when the first listener is added.
 *
 * The failures of the remote actions are thrown as `ServiceInvokeException`, with the remote error's message and
 * properties (`errno`, `statusCode`…) and the address as its `service`; a service that gives no response (unreachable,
 * too slow, or an answer that is not a service response) as a `ServiceUnavailableException`.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {type HTTPServiceProxy, ServiceInvokeException, ServiceUnavailableException} from 'lakutata/com/entrypoint'
 * import {Inject} from 'lakutata/decorator/di'
 *
 * class StockWatcher extends Component {
 *     //Registered as inventory: buildHTTPServiceProxy({url: 'http://inventory.internal:3000/'})
 *     @Inject('inventory')
 *     protected readonly inventory: HTTPServiceProxy
 *
 *     protected async init(): Promise<void> {
 *         //The events the inventory pushes with Entrypoint.notify(clientId, 'lowStock', product, quantity)
 *         this.inventory.on('lowStock', (product: string, quantity: number): void => {
 *             console.log(`${product}: ${quantity} left`)
 *         })
 *     }
 *
 *     public async quantity(product: string): Promise<number | undefined> {
 *         try {
 *             //5 seconds at most; the inventory aborts the action's signal when the call gives up
 *             return await this.inventory.invoke({cmd: 'stock.get', product: product}, 5000)
 *         } catch (error) {
 *             //The action failed: its error
 *             if (error instanceof ServiceInvokeException && error.errno === 'E_PRODUCT_NOT_FOUND') return undefined
 *             //The inventory gave no response
 *             if (error instanceof ServiceUnavailableException) return undefined
 *             throw error
 *         }
 *     }
 * }
 * ```
 */
export class HTTPServiceProxy extends Component {

    /**
     * The service's address, as configured (see {@link BuildHTTPServiceProxyOptions.url}); required.
     */
    @Configurable(DTO.String().uri({scheme: ['http', 'https']}).required())
    protected readonly url: string

    /**
     * The headers sent with each call and with the event stream; none by default.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    protected readonly headers?: Record<string, string>

    /**
     * The configured client id; a random UUID is used without it (see {@link HTTPServiceProxy.id}).
     */
    @Configurable(DTO.String().max(200).optional())
    protected readonly clientId?: string

    /**
     * The delay, in milliseconds, before the event stream is opened again.
     * @default 1000
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(1000))
    protected readonly reconnectDelay: number

    #id: string

    #eventsURL: string

    readonly #listeners: Map<string, Set<{ listener: (...args: any[]) => void, once: boolean }>> = new Map()

    #events: AbortController | undefined

    #destroyed: boolean = false

    /**
     * Create the client id and the address of the event stream (`<url>/events?id=<id>`); nothing connects before the
     * first call.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#id = this.clientId ?? randomUUID()
        const events: URL = new URL(this.url)
        events.pathname = `${events.pathname.replace(/\/+$/, '')}/events`
        events.searchParams.set('id', this.#id)
        this.#eventsURL = events.href
    }

    /**
     * Close the event stream and remove the listeners (the calls in progress complete).
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        this.#events?.abort()
        this.#listeners.clear()
    }

    /**
     * The client's id: the configured `clientId`, or a random UUID. It is sent as the `id` header of the calls, and is
     * the `ServiceContext.clientId` of the service's actions.
     */
    public get id(): string {
        return this.#id
    }

    /**
     * Invoke an action of the service, matched by its pattern.
     * @param input The action's pattern and its input in one object (`{cmd: 'order.get', id: 1}`), sent as JSON: the
     * values JSON cannot hold (functions, `undefined`, class instances) are lost or turned into plain objects.
     * @param timeout The longest wait for the response, in milliseconds; 600000 (10 minutes) by default. The request is
     * abandoned after it, and the service aborts the action's signal.
     * @returns The action's result, decoded from JSON: `undefined` when the action returned nothing.
     * @throws {ServiceInvokeException} When the action fails (no action matches the pattern, an invalid input, an error
     * thrown, the service stopping), or the service refuses the request (another path, a body over its limit): the
     * remote error's message and properties (`errno`…), the address as its `service`.
     * @throws {ServiceUnavailableException} When the service gives no response: unreachable, no response within the
     * timeout, or an answer that is not a service response. Its `cause` is the error of the request.
     */
    public async invoke<T extends Record<string, any>>(input: ActionPattern<T>, timeout: number = 10 * 60 * 1000): Promise<any> {
        let status: number
        let text: string
        const signal: AbortSignal = AbortSignal.timeout(timeout)
        try {
            const response: HTTPResponse = await send(this.url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...this.headers, 'id': this.#id},
                body: JSON.stringify(input),
                signal: signal
            })
            status = response.status
            text = await textOf(response.body)
        } catch (error) {
            //A timeout is told by the signal: the fetch of Node.js 18.10 fails with an AbortError, not with the signal's TimeoutError
            const timedOut: boolean = (error as Error)?.name === 'TimeoutError' || (signal.aborted && (signal.reason as Error)?.name === 'TimeoutError')
            const exception: ServiceUnavailableException = timedOut
                ? new ServiceUnavailableException('The service {service} gave no response within {timeout} ms', {service: this.url, timeout: timeout})
                : new ServiceUnavailableException('The service {service} cannot be reached: {reason}', {service: this.url, reason: reasonOf(error)})
            exception.service = this.url
            exception.cause = timedOut && signal.reason ? signal.reason : error
            throw exception
        }
        let body: unknown
        try {
            body = JSON.parse(text)
        } catch {
            //Not JSON: below
        }
        if (!isServiceResponse(body)) {
            const exception: ServiceUnavailableException = new ServiceUnavailableException('The service {service} answered {status} without a service response', {service: this.url, status: status})
            exception.service = this.url
            throw exception
        }
        return ServiceResponseCodec.decode(body, this.url)
    }

    /**
     * Listen to an event the service pushes to this client (`Entrypoint.notify()`, `broadcast()`); the first listener
     * opens the event stream. The listeners' errors are ignored. The `client` event, received when the stream opens,
     * carries the client's id.
     * @param eventName The event's name.
     * @param listener Called with the event's arguments, decoded from JSON.
     * @returns The proxy, to chain the calls.
     */
    public on(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, false)
    }

    /**
     * Listen to an event the service pushes to this client, once: the listener is removed before it is called.
     * @param eventName The event's name.
     * @param listener Called with the event's arguments, decoded from JSON.
     * @returns The proxy, to chain the calls.
     */
    public once(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, true)
    }

    /**
     * Stop listening to an event; removing the last listener of all the events closes the event stream.
     * @param eventName The event's name.
     * @param listener The listener to remove; without it, all the event's listeners are removed.
     * @returns The proxy, to chain the calls.
     */
    public off(eventName: string, listener?: (...args: any[]) => void): this {
        const listeners = this.#listeners.get(eventName)
        if (listeners && listener) listeners.forEach((entry): unknown => entry.listener === listener && listeners.delete(entry))
        if (!listener || !listeners?.size) this.#listeners.delete(eventName)
        if (!this.#listeners.size) {
            this.#events?.abort()
            this.#events = undefined
        }
        return this
    }

    /**
     * Add a listener, and open the event stream when it is not open.
     * @param eventName The event's name.
     * @param listener The listener.
     * @param once Whether the listener is removed after its first call.
     * @returns The proxy.
     * @protected
     */
    protected add(eventName: string, listener: (...args: any[]) => void, once: boolean): this {
        if (!this.#listeners.has(eventName)) this.#listeners.set(eventName, new Set())
        this.#listeners.get(eventName)!.add({listener: listener, once: once})
        if (!this.#events) void this.stream()
        return this
    }

    /**
     * Read the event stream and call the listeners; the stream is opened again after `reconnectDelay` milliseconds
     * when it ends or fails, while there are listeners. It stops once no listener is left (removed by
     * {@link HTTPServiceProxy.off}, or the last `once()` listener called) or the proxy is destroyed.
     * @returns A promise resolved once the reading stops.
     * @protected
     */
    protected async stream(): Promise<void> {
        const abort: AbortController = new AbortController()
        this.#events = abort
        while (!abort.signal.aborted && !this.#destroyed && this.#listeners.size) {
            try {
                const response: HTTPResponse = await send(this.#eventsURL, {headers: {...this.headers, 'Accept': 'text/event-stream'}, signal: abort.signal})
                if (response.status >= 200 && response.status < 300) {
                    for await (const {event, data} of serverSentEvents(response.body)) {
                        const listeners = this.#listeners.get(event)
                        if (!listeners) continue
                        let args: unknown
                        try {
                            args = JSON.parse(data)
                        } catch {
                            continue
                        }
                        for (const entry of [...listeners]) {
                            if (entry.once) listeners.delete(entry)
                            try {
                                entry.listener(...Array.isArray(args) ? args : [args])
                            } catch {
                                //The errors of the listeners are theirs
                            }
                        }
                        if (!listeners.size) this.#listeners.delete(event)
                        //The last listener gone (a once listener called): the stream is closed
                        if (!this.#listeners.size) abort.abort()
                    }
                } else {
                    await response.cancel()
                }
            } catch {
                //The service is gone: listened again after the delay
            }
            if (abort.signal.aborted || this.#destroyed) break
            await new Promise((resolve): unknown => setTimeout(resolve, this.reconnectDelay))
        }
        if (this.#events === abort) this.#events = undefined
    }
}
