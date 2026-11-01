import {createRequire} from 'node:module'
import path from 'node:path'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The name of the events of the bridge {@link capacitorServiceEntrypoint} receives and posts by default
 */
export const CAPACITOR_SERVICE_EVENT: string = 'lakutata:service'

/**
 * The bridge of `@capawesome/capacitor-nodejs` in the Node.js of the mobile application (`require('bridge')`): its
 * channel to the web view, and the lifecycle of the application. Only the parts {@link capacitorServiceEntrypoint} uses.
 */
export type CapacitorBridge = {
    /**
     * The channel to the web view: the messages the page sends (`Nodejs.send({eventName, args})`), the ones posted to it
     * (its `message` listeners receive `{eventName, args}`). The arguments are sent as JSON.
     */
    channel: {
        on(event: string, listener: (...args: any[]) => void): unknown
        removeListener(event: string, listener: (...args: any[]) => void): unknown
        post(event: string, ...args: unknown[]): void
    }
    /**
     * The lifecycle of the application: it goes to the background (`pause`, with a lock to release once ready), and
     * comes back (`resume`).
     */
    app?: {
        on(event: 'pause', listener: (lock: { release(): void }) => void): unknown
        on(event: 'resume', listener: () => void): unknown
        removeListener?(event: string, listener: (...args: any[]) => void): unknown
    }
}

/**
 * A message the page sends to the adapter (the argument of `Nodejs.send({eventName: 'lakutata:service', args: [message]})`):
 * `{type: 'invoke', id, clientId?, data}`, `{type: 'subscribe', clientId}` or `{type: 'unsubscribe', clientId}`
 */
export type CapacitorServiceRequest = {
    /**
     * What the page asks: to invoke an action, to make its page a client (the events pushed to it are posted), or to
     * remove its client (its page left: its requests in progress are aborted)
     */
    type: 'invoke' | 'subscribe' | 'unsubscribe'
    /**
     * The id of the invocation, which its response carries (invoke)
     */
    id?: string | number
    /**
     * The id of the page (a non-empty string of at most 200 characters): the `clientId` of the context of its requests
     * (optional to invoke, required to subscribe and to unsubscribe)
     */
    clientId?: string
    /**
     * The action's pattern and its input, as `{cmd: 'greet', name: 'you'}` (invoke)
     */
    data?: Record<string, unknown>
}

/**
 * A message the adapter posts to the page: `{type: 'response', id, response}`, the response of an invocation,
 * `{type: 'event', clientId, event, args}`, an event pushed to a client, or `{type: 'subscribed', clientId}`, the
 * answer to a subscription
 */
export type CapacitorServiceMessage = {
    /**
     * What the adapter posts: the response of an invocation, an event pushed to a client, or the answer to a
     * subscription
     */
    type: 'response' | 'event' | 'subscribed'
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
 * The options of {@link capacitorServiceEntrypoint}.
 */
export type CapacitorServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The bridge of `@capawesome/capacitor-nodejs`.
     * @default `require('bridge')`, the module the plugin gives the Node.js of the application (in its main thread only)
     */
    bridge?: CapacitorBridge
    /**
     * The name of the events of the bridge the adapter receives and posts.
     * @default 'lakutata:service'
     */
    event?: string
    /**
     * Called when the application goes to the background, before the plugin is told the Node.js side is ready for it
     * (on iOS, the application keeps running until then, for the time the system gives): write what has to be
     * written. Its failure is ignored.
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
 * A client of the adapter: the page given by its id, its requests in progress
 */
type CapacitorClient = {
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
 * The bridge the plugin gives the Node.js of the application. It is found through the NODE_PATH the plugin sets, which
 * an ES module does not read: the bridge is required, from any directory (the working directory is / on iOS). The
 * plugin gives it to the main thread only: required in a worker thread, it fails, and the plugin crashes the
 * application later
 */
function loadBridge(): CapacitorBridge {
    try {
        return createRequire(path.join(process.cwd(), 'index.js'))('bridge') as CapacitorBridge
    } catch (error) {
        if (/Channel already exists/.test((error as Error)?.message)) throw new Error('capacitorServiceEntrypoint runs in the main thread of Node.js: the bridge of @capawesome/capacitor-nodejs is not usable in a worker thread', {cause: error})
        throw new Error('capacitorServiceEntrypoint runs in the Node.js of @capawesome/capacitor-nodejs (or is given its bridge)', {cause: error})
    }
}

/**
 * Create a service adapter of an entrypoint served to the web view of a mobile application of Capacitor (iOS, Android),
 * in the Node.js that `@capawesome/capacitor-nodejs` embeds in the application. It listens to the messages of the page on the bridge of
 * the plugin and posts its responses and events there, as JSON (the plugin sends JSON only).
 *
 * The page sends `Nodejs.send({eventName: 'lakutata:service', args: [message]})`, the message being
 * `{type: 'invoke', id, clientId?, data}` (the action's pattern and input in `data`), `{type: 'subscribe', clientId}` or
 * `{type: 'unsubscribe', clientId}`; its `message` listener receives `{eventName: 'lakutata:service', args: [message]}`,
 * the message being `{type: 'response', id, response}` (`{success, error, payload}`, see `ServiceResponseCodec`:
 * `payload` is the result, or `error` the whole error object when the action failed) or
 * `{type: 'event', clientId, event, args}` (an event pushed by `Entrypoint.notify` or `Entrypoint.broadcast`) or
 * `{type: 'subscribed', clientId}` (the answer to a subscription). The plugin tells the page the Node.js side is ready
 * once `require('bridge')` first runs, which may come before the application listens (the messages sent until then
 * are lost): the page sends its subscription again until it is answered, and invokes the actions after. A
 * result JSON cannot hold (a bigint, a cycle) is answered with an error; the values JSON changes arrive changed (a
 * `Date` as its string, a `Buffer` as `{type, data}`, `undefined` left out). Each page is a client, identified by the
 * id it gives (a non-empty string of at most 200 characters), which its requests carry as `ServiceContext.clientId`;
 * unsubscribing aborts its requests in progress (their abort signal fires).
 *
 * The plugin's `pause` event (the application going to the background) calls the `pause` option, then tells the
 * plugin the Node.js side is ready; `resume` calls the `resume` option. When the entrypoint stops, the new invocations
 * are answered with an `EntrypointStoppedException` error; once the requests in progress end, it stops listening.
 * @param options The adapter options; by default the bridge is `require('bridge')` and the events are named
 * `lakutata:service`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {capacitorServiceEntrypoint} from 'lakutata/adapter/capacitor'
 *
 * class EchoController extends Controller {
 *     @ServiceAction({cmd: 'echo'})
 *     public async echo(input: {text: string}): Promise<string> {
 *         return input.text
 *     }
 * }
 *
 * //In the Node.js of the mobile application (the project of @capawesome/capacitor-nodejs)
 * Application.run({
 *     id: 'mobile.app',
 *     name: 'Mobile',
 *     //Its process is the whole application: the application leaves it running
 *     exitProcess: false,
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [EchoController],
 *             service: capacitorServiceEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //In the page: import {Nodejs} from '@capawesome/capacitor-nodejs'
 * //Nodejs.addListener('message', ({eventName, args}) => eventName === 'lakutata:service' && console.log(args[0]))
 * //Nodejs.send({eventName: 'lakutata:service', args: [{type: 'subscribe', clientId: 'page'}]})
 * //→ {type: 'subscribed', clientId: 'page'} (the subscription sent again until it comes)
 * //Nodejs.send({eventName: 'lakutata:service', args: [{type: 'invoke', id: 1, clientId: 'page', data: {cmd: 'echo', text: 'hi'}}]})
 * //→ {type: 'response', id: 1, response: {success: true, error: null, payload: 'hi'}}
 * ```
 */
export function capacitorServiceEntrypoint(options: CapacitorServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const event: string = options.event ?? CAPACITOR_SERVICE_EVENT
    const clients: Map<string, CapacitorClient> = new Map()
    let bridge: CapacitorBridge | undefined
    let stopping: boolean = false
    let listener: ((message: unknown) => void) | undefined
    let pause: ((lock: { release(): void }) => void) | undefined
    let resume: (() => void) | undefined

    /**
     * Post a message to the page; a message JSON cannot hold is not posted
     * @param message
     */
    const post = (message: CapacitorServiceMessage): boolean => {
        try {
            JSON.stringify(message)
        } catch {
            return false
        }
        bridge!.channel.post(event, message)
        return true
    }

    /**
     * Answer an invocation, with an error when its response cannot be sent as JSON
     * @param id
     * @param response
     */
    const answer = (id: string | number, response: ServiceResponse): void => {
        if (post({type: 'response', id: id, response: response})) return
        post({type: 'response', id: id, response: ServiceResponseCodec.encodeError(new TypeError('The result of the action cannot be sent as JSON'))})
    }

    /**
     * Run an invocation of the page
     * @param runtime
     * @param request
     */
    const invoke = async (runtime: ChannelRuntime<ServiceContext>, request: CapacitorServiceRequest & { id: string | number }): Promise<void> => {
        if (stopping) return answer(request.id, ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
        //The request is aborted when its client is removed
        const abort: AbortController = new AbortController()
        const client: CapacitorClient | undefined = isClientId(request.clientId) ? clients.get(request.clientId) : undefined
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

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<ServiceContext>): void => {
            bridge = options.bridge ?? loadBridge()
            listener = (message: unknown): void => {
                if (!message || typeof message !== 'object') return
                const request: CapacitorServiceRequest = message as CapacitorServiceRequest
                switch (request.type) {
                    case 'invoke':
                        if (typeof request.id === 'string' || typeof request.id === 'number') void invoke(runtime, request as CapacitorServiceRequest & { id: string | number })
                        return
                    case 'subscribe':
                        //Subscribed again (its page loaded again, or its subscription sent again): its requests in
                        //progress are kept; answered each time
                        if (!isClientId(request.clientId)) return
                        clients.set(request.clientId, {requests: clients.get(request.clientId)?.requests ?? new Set()})
                        post({type: 'subscribed', clientId: request.clientId})
                        return
                    case 'unsubscribe': {
                        const client: CapacitorClient | undefined = isClientId(request.clientId) ? clients.get(request.clientId) : undefined
                        if (!client) return
                        clients.delete(request.clientId!)
                        for (const abort of client.requests) abort.abort()
                    }
                }
            }
            bridge.channel.on(event, listener)
            pause = (lock: { release(): void }): void => void Promise.resolve()
                .then((): unknown => options.pause?.())
                .catch((): void => undefined)
                .then((): void => lock.release())
            resume = (): void => void Promise.resolve()
                .then((): unknown => options.resume?.())
                .catch((): void => undefined)
            bridge.app?.on('pause', pause)
            bridge.app?.on('resume', resume)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: (): void => {
            if (listener) bridge?.channel.removeListener(event, listener)
            if (pause) bridge?.app?.removeListener?.('pause', pause)
            if (resume) bridge?.app?.removeListener?.('resume', resume)
            clients.clear()
        },
        notify: (clientId: string, name: string, args: unknown[]): boolean => {
            return clients.has(clientId) && post({type: 'event', clientId: clientId, event: name, args: args})
        },
        broadcast: (name: string, args: unknown[]): number => {
            let sent: number = 0
            for (const clientId of clients.keys()) if (post({type: 'event', clientId: clientId, event: name, args: args})) sent++
            return sent
        }
    }
}
