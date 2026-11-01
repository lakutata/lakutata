import net from 'node:net'
import type {Duplex} from 'node:stream'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The environment variable giving the Node.js of the mobile application the file descriptor of its socket to the host
 * (the native module of the application), which {@link reactNativeServiceEntrypoint} opens by default
 */
export const REACT_NATIVE_NODE_FD: string = 'LAKUTATA_NODE_FD'

/**
 * A message the host sends to the adapter, one JSON object per line: `{type: 'invoke', id, clientId?, data}`,
 * `{type: 'subscribe', clientId}`, `{type: 'unsubscribe', clientId}`, `{type: 'pause'}` or `{type: 'resume'}`
 */
export type ReactNativeServiceRequest = {
    /**
     * What the host asks: to invoke an action, to make its user interface a client (the events pushed to it are sent),
     * to remove its client (its requests in progress are aborted), or tells the application that it goes to the
     * background (pause, answered with paused) or comes back (resume)
     */
    type: 'invoke' | 'subscribe' | 'unsubscribe' | 'pause' | 'resume'
    /**
     * The id of the invocation, which its response carries (invoke)
     */
    id?: string | number
    /**
     * The id of the user interface (a non-empty string of at most 200 characters): the `clientId` of the context of its
     * requests (optional to invoke, required to subscribe and to unsubscribe)
     */
    clientId?: string
    /**
     * The action's pattern and its input, as `{cmd: 'greet', name: 'you'}` (invoke)
     */
    data?: Record<string, unknown>
}

/**
 * A message the adapter sends to the host, one JSON object per line: `{type: 'response', id, response}`, the response
 * of an invocation, `{type: 'event', clientId, event, args}`, an event pushed to a client, `{type: 'subscribed',
 * clientId}`, the answer to a subscription, or `{type: 'paused'}`, the application ready to be suspended
 */
export type ReactNativeServiceMessage = {
    /**
     * What the adapter sends: the response of an invocation, an event pushed to a client, the answer to a subscription,
     * or the answer to a pause
     */
    type: 'response' | 'event' | 'subscribed' | 'paused'
    /**
     * The id of the invocation answered (response)
     */
    id?: string | number
    /**
     * `{success, error, payload}` (see `ServiceResponseCodec`): `payload` is the result, or `error` the whole error
     * object when the action failed (response)
     */
    response?: ServiceResponse
    /**
     * The client the event is pushed to (event), or the one subscribed (subscribed)
     */
    clientId?: string
    /**
     * The name of the event (event)
     */
    event?: string
    /**
     * The arguments of the event (event)
     */
    args?: unknown[]
}

/**
 * The options of {@link reactNativeServiceEntrypoint}.
 */
export type ReactNativeServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The connection to the host, already open: a stream of lines of JSON both ways.
     * @default a socket on the file descriptor given by the environment variable `LAKUTATA_NODE_FD`, which the native
     * module of the application gives the Node.js it starts
     */
    socket?: Duplex
    /**
     * Called when the application goes to the background, before the host is told the application is ready for it (on
     * iOS, the application keeps running until then, for the time the system gives): write what has to be written. Its
     * failure is ignored.
     */
    pause?: () => void | Promise<void>
    /**
     * Called when the application comes back from the background. Its failure is ignored.
     */
    resume?: () => void | Promise<void>
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * A client of the adapter: the user interface given by its id, its requests in progress
 */
type ReactNativeClient = {
    requests: Set<AbortController>
}

/**
 * Whether a client id is one: a non-empty string of at most 200 characters
 * @param clientId
 */
function isClientId(clientId: unknown): clientId is string {
    return typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 200
}

/**
 * The socket to the host on the file descriptor the native module of the application gives
 */
function openHostSocket(): Duplex {
    const fd: number = Number(process.env[REACT_NATIVE_NODE_FD])
    if (!process.env[REACT_NATIVE_NODE_FD] || !Number.isInteger(fd) || fd < 0) throw new Error(`reactNativeServiceEntrypoint runs in the Node.js started by the native module of the application (${REACT_NATIVE_NODE_FD}), or is given a socket`)
    return new net.Socket({fd: fd, readable: true, writable: true})
}

/**
 * Create a service adapter of an entrypoint served to the user interface of a mobile application of React Native
 * (Android, iOS, HarmonyOS), in the Node.js the native module of the application embeds and starts. The native module
 * gives the Node.js the file descriptor of a socket (the environment variable `LAKUTATA_NODE_FD`); the adapter reads the
 * messages of the host there and writes its responses and events, one JSON object per line. Any host speaking the same
 * lines may use it (the `socket` option takes the connection).
 *
 * The host sends `{type: 'invoke', id, clientId?, data}` (the action's pattern and input in `data`),
 * `{type: 'subscribe', clientId}` or `{type: 'unsubscribe', clientId}`; the adapter sends `{type: 'response', id,
 * response}` (`{success, error, payload}`, see `ServiceResponseCodec`: `payload` is the result, or `error` the whole
 * error object when the action failed), `{type: 'event', clientId, event, args}` (an event pushed by `Entrypoint.notify`
 * or `Entrypoint.broadcast`) or `{type: 'subscribed', clientId}` (the answer to a subscription, once the application
 * listens). The lines the host writes before the application listens wait in the socket. A result JSON cannot hold (a
 * bigint, a cycle) is answered with an error; the values JSON changes arrive changed (a `Date` as its string, a
 * `Buffer` as `{type, data}`, `undefined` left out). Each user interface is a client, identified by the id it gives (a
 * non-empty string of at most 200 characters), which its requests carry as `ServiceContext.clientId`; unsubscribing
 * aborts its requests in progress (their abort signal fires).
 *
 * `{type: 'pause'}` (the application going to the background) calls the `pause` option, then answers
 * `{type: 'paused'}`; `{type: 'resume'}` calls the `resume` option. When the entrypoint stops, the new invocations are
 * answered with an `EntrypointStoppedException` error; once the requests in progress end, it stops listening and closes
 * the socket it opened.
 * @param options The adapter options; by default the socket is the one on `LAKUTATA_NODE_FD`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {reactNativeServiceEntrypoint} from 'lakutata/adapter/react-native'
 *
 * class EchoController extends Controller {
 *     @ServiceAction({cmd: 'echo'})
 *     public async echo(input: {text: string}): Promise<string> {
 *         return input.text
 *     }
 * }
 *
 * //In the Node.js of the mobile application
 * Application.run({
 *     id: 'mobile.app',
 *     name: 'Mobile',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [EchoController],
 *             service: reactNativeServiceEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //The host writes: {"type":"subscribe","clientId":"ui"}
 * //→ {"type":"subscribed","clientId":"ui"}
 * //The host writes: {"type":"invoke","id":1,"clientId":"ui","data":{"cmd":"echo","text":"hi"}}
 * //→ {"type":"response","id":1,"response":{"success":true,"error":null,"payload":"hi"}}
 * ```
 */
export function reactNativeServiceEntrypoint(options: ReactNativeServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const clients: Map<string, ReactNativeClient> = new Map()
    let socket: Duplex | undefined
    let stopping: boolean = false
    let listener: ((chunk: string | Buffer) => void) | undefined

    /**
     * Send a message to the host; a message JSON cannot hold is not sent
     * @param message
     */
    const send = (message: ReactNativeServiceMessage): boolean => {
        let line: string
        try {
            line = JSON.stringify(message)
        } catch {
            return false
        }
        if (!socket || socket.destroyed || !socket.writable) return false
        socket.write(line + '\n')
        return true
    }

    /**
     * Answer an invocation, with an error when its response cannot be sent as JSON
     * @param id
     * @param response
     */
    const answer = (id: string | number, response: ServiceResponse): void => {
        if (send({type: 'response', id: id, response: response})) return
        send({type: 'response', id: id, response: ServiceResponseCodec.encodeError(new TypeError('The result of the action cannot be sent as JSON'))})
    }

    /**
     * Run an invocation of the host
     * @param runtime
     * @param request
     */
    const invoke = async (runtime: ChannelRuntime<ServiceContext>, request: ReactNativeServiceRequest & { id: string | number }): Promise<void> => {
        if (stopping) return answer(request.id, ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
        //The request is aborted when its client is removed
        const abort: AbortController = new AbortController()
        const client: ReactNativeClient | undefined = isClientId(request.clientId) ? clients.get(request.clientId) : undefined
        client?.requests.add(abort)
        let response: ServiceResponse
        try {
            const context: ServiceContext = new ServiceContext({data: request.data && typeof request.data === 'object' ? request.data : {}, clientId: isClientId(request.clientId) ? request.clientId : undefined})
            response = ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: abort.signal}), false)
        } catch (error: unknown) {
            response = ServiceResponseCodec.encodeError(error)
        } finally {
            client?.requests.delete(abort)
        }
        answer(request.id, response)
    }

    /**
     * Handle a message of the host
     * @param runtime
     * @param message
     */
    const receive = (runtime: ChannelRuntime<ServiceContext>, message: unknown): void => {
        if (!message || typeof message !== 'object') return
        const request: ReactNativeServiceRequest = message as ReactNativeServiceRequest
        switch (request.type) {
            case 'invoke':
                if (typeof request.id === 'string' || typeof request.id === 'number') void invoke(runtime, request as ReactNativeServiceRequest & { id: string | number })
                return
            case 'subscribe':
                //Subscribed again (its user interface loaded again): its requests in progress are kept; answered each time
                if (!isClientId(request.clientId)) return
                clients.set(request.clientId, {requests: clients.get(request.clientId)?.requests ?? new Set()})
                send({type: 'subscribed', clientId: request.clientId})
                return
            case 'unsubscribe': {
                const client: ReactNativeClient | undefined = isClientId(request.clientId) ? clients.get(request.clientId) : undefined
                if (!client) return
                clients.delete(request.clientId!)
                for (const abort of client.requests) abort.abort()
                return
            }
            case 'pause':
                void Promise.resolve()
                    .then((): unknown => options.pause?.())
                    .catch((): void => undefined)
                    .then((): unknown => send({type: 'paused'}))
                return
            case 'resume':
                void Promise.resolve()
                    .then((): unknown => options.resume?.())
                    .catch((): void => undefined)
        }
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<ServiceContext>): void => {
            socket = options.socket ?? openHostSocket()
            socket.setEncoding('utf8')
            //The lines of the host, a line cut across chunks kept until its end comes
            let buffer: string = ''
            listener = (chunk: string | Buffer): void => {
                buffer += chunk
                for (let end: number = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                    const line: string = buffer.slice(0, end).trim()
                    buffer = buffer.slice(end + 1)
                    if (!line) continue
                    let message: unknown
                    try {
                        message = JSON.parse(line)
                    } catch {
                        continue
                    }
                    receive(runtime, message)
                }
            }
            socket.on('data', listener)
            //The host gone: nothing more to write
            socket.on('error', (): void => undefined)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: (): void => {
            if (listener) socket?.removeListener('data', listener)
            //The socket opened on the file descriptor of the host is closed; a socket given is left to its owner
            if (!options.socket) socket?.destroy()
            clients.clear()
        },
        notify: (clientId: string, name: string, args: unknown[]): boolean => {
            return clients.has(clientId) && send({type: 'event', clientId: clientId, event: name, args: args})
        },
        broadcast: (name: string, args: unknown[]): number => {
            let sent: number = 0
            for (const clientId of clients.keys()) if (send({type: 'event', clientId: clientId, event: name, args: args})) sent++
            return sent
        }
    }
}
