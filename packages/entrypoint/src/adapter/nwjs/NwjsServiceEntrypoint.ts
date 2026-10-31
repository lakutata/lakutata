import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The key of the bridge of {@link nwjsServiceEntrypoint} on the global object of NW.js by default
 */
export const NWJS_SERVICE_BRIDGE: string = 'lakutata:service'

/**
 * The bridge {@link nwjsServiceEntrypoint} puts on the global object of NW.js (`global[Symbol.for(key)]`), which the
 * windows share with the Node.js context: the trusted page of a window (the one holding the user interface in a
 * `<webview>`) forwards to it the requests of the interface, and gives it the function pushing the events to it.
 */
export type NwjsServiceBridge = {
    /**
     * Invoke a service action.
     * @param data The action's pattern and its input (`{cmd: 'greet', name: 'you'}`).
     * @param clientId The id of the page invoking: the `clientId` of the request's context.
     * @returns `{success, error, payload}` (see `ServiceResponseCodec`).
     */
    invoke(data: Record<string, unknown>, clientId?: string): Promise<ServiceResponse>
    /**
     * Register a page as a client: the events pushed to it (`Entrypoint.notify`, `broadcast`) are given to `push`.
     * @param clientId The id of the page (a non-empty string of at most 200 characters).
     * @param push Gives an event and its arguments to the page.
     */
    subscribe(clientId: string, push: (event: string, args: unknown[]) => void): void
    /**
     * Remove a client, when its page is loaded again or its window closed: its requests in progress are aborted.
     * @param clientId The id of the page.
     */
    unsubscribe(clientId: string): void
}

/**
 * The options of {@link nwjsServiceEntrypoint}.
 */
export type NwjsServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The key of the bridge: it is put on `global[Symbol.for(key)]`.
     * @default 'lakutata:service'
     */
    key?: string
    /**
     * The object the bridge is put on.
     * @default the global object (the one NW.js shares with its windows)
     */
    global?: object
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * A client of the adapter: the function pushing the events to its page, the requests it has in progress
 */
type NwjsClient = {
    push: (event: string, args: unknown[]) => void
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
 * Create a service adapter of an entrypoint served to the windows of NW.js, in its Node.js context (the background
 * script of the application). It puts a {@link NwjsServiceBridge} on the global object, which NW.js shares with the pages
 * of its windows: the trusted page of a window holds the user interface in a `<webview>` (the interface has no Node.js),
 * and forwards the messages of the interface to the bridge.
 *
 * `bridge.invoke(data, clientId)` resolves to `{success, error, payload}` (see `ServiceResponseCodec`): `payload` is the
 * result, or `error` the whole error object when the action failed (no matching action, validation…). Each page is a
 * client, identified by the id it gives (a non-empty string of at most 200 characters), which its requests carry as
 * `ServiceContext.clientId`; `bridge.subscribe(clientId, push)` registers it for the events pushed by
 * `Entrypoint.notify` and `Entrypoint.broadcast`, and `bridge.unsubscribe(clientId)` removes it (its page loaded again,
 * its window closed), aborting its requests in progress (their abort signal fires). A push that throws (its window is
 * gone) removes its client.
 *
 * When the entrypoint stops, the new invocations resolve to an `EntrypointStoppedException` error; once the requests
 * in progress end, the bridge is removed.
 * @param options The adapter options; by default the bridge is `global[Symbol.for('lakutata:service')]`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {nwjsServiceEntrypoint, type NwjsServiceBridge} from 'lakutata/adapter/nwjs'
 *
 * class EchoController extends Controller {
 *     @ServiceAction({cmd: 'echo'})
 *     public async echo(input: {text: string}): Promise<string> {
 *         return input.text
 *     }
 * }
 *
 * //In the background script of the application (its Node.js context)
 * Application.run({
 *     id: 'desktop.app',
 *     name: 'Desktop',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [EchoController],
 *             service: nwjsServiceEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //In the trusted page of a window, which shares the global object with the Node.js context
 * declare const global: Record<symbol, NwjsServiceBridge>
 * const bridge: NwjsServiceBridge = global[Symbol.for('lakutata:service')]
 * const clientId: string = crypto.randomUUID()
 * //The events pushed by entrypoint.notify(clientId, 'progress', 50)
 * bridge.subscribe(clientId, (name: string, args: unknown[]): void => console.log(name, ...args))
 * //{success: true, error: null, payload: 'hi'}
 * console.log(await bridge.invoke({cmd: 'echo', text: 'hi'}, clientId))
 * ```
 */
export function nwjsServiceEntrypoint(options: NwjsServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const key: symbol = Symbol.for(options.key ?? NWJS_SERVICE_BRIDGE)
    const target: Record<symbol, unknown> = (options.global ?? globalThis) as Record<symbol, unknown>
    let stopping: boolean = false
    const clients: Map<string, NwjsClient> = new Map()

    /**
     * Push an event to a client, removed when its push throws
     * @param clientId
     * @param client
     * @param event
     * @param args
     */
    const push = (clientId: string, client: NwjsClient, event: string, args: unknown[]): boolean => {
        try {
            client.push(event, args)
            return true
        } catch {
            clients.delete(clientId)
            return false
        }
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<ServiceContext>): void => {
            const bridge: NwjsServiceBridge = {
                invoke: async (data: Record<string, unknown>, clientId?: string): Promise<ServiceResponse> => {
                    if (stopping) return ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping'))
                    //The request is aborted when its client is removed
                    const request: AbortController = new AbortController()
                    const client: NwjsClient | undefined = isClientId(clientId) ? clients.get(clientId) : undefined
                    client?.requests.add(request)
                    try {
                        const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data : {}, clientId: isClientId(clientId) ? clientId : undefined})
                        return ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: request.signal}), false)
                    } catch (error: unknown) {
                        return ServiceResponseCodec.encodeError(error)
                    } finally {
                        client?.requests.delete(request)
                    }
                },
                subscribe: (clientId: string, pushTo: (event: string, args: unknown[]) => void): void => {
                    if (!isClientId(clientId) || typeof pushTo !== 'function') return
                    clients.set(clientId, {push: pushTo, requests: clients.get(clientId)?.requests ?? new Set()})
                },
                unsubscribe: (clientId: string): void => {
                    const client: NwjsClient | undefined = clients.get(clientId)
                    if (!client) return
                    clients.delete(clientId)
                    for (const request of client.requests) request.abort()
                }
            }
            target[key] = bridge
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: (): void => {
            delete target[key]
            clients.clear()
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const client: NwjsClient | undefined = clients.get(clientId)
            return !!client && push(clientId, client, event, args)
        },
        broadcast: (event: string, args: unknown[]): number => {
            let sent: number = 0
            for (const [clientId, client] of [...clients]) if (push(clientId, client, event, args)) sent++
            return sent
        }
    }
}
