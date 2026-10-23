import {InvalidValueException} from '@lakutata/core'
import type {ChannelRuntime} from '../../channel/EntrypointAdapter.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceResponseCodec} from '../../lib/ServiceResponseCodec.js'
import {ControllerActionNotFoundException} from '../../exceptions/ControllerActionNotFoundException.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The error codes of the JSON-RPC 2.0 responses sent by {@link jsonRPCServiceEntrypoint}.
 */
export const JSONRPCErrorCode = {
    /**
     * The message is not valid JSON.
     */
    PARSE_ERROR: -32700,
    /**
     * The message is not a JSON-RPC 2.0 request (or is an empty batch, or the HTTP request is not a `POST` to the path).
     */
    INVALID_REQUEST: -32600,
    /**
     * No service action matches the request (`ControllerActionNotFoundException`).
     */
    METHOD_NOT_FOUND: -32601,
    /**
     * The params are given by position without the `positionalParams` option, or fail the action's input validation
     * (`InvalidValueException`).
     */
    INVALID_PARAMS: -32602,
    /**
     * Reserved by the specification for the internal errors; the adapter does not send it.
     */
    INTERNAL_ERROR: -32603,
    /**
     * Any other error thrown by an action (in the server error range, -32000 to -32099), with the whole error object as
     * the error's `data`.
     */
    SERVER_ERROR: -32000,
    /**
     * The entrypoint is stopping and refuses the new requests (`EntrypointStoppedException`).
     */
    STOPPING: -32001
} as const

/**
 * A JSON-RPC 2.0 request, as a client sends it. Without an `id`, it is a notification: the action runs but no response
 * is sent.
 */
export type JSONRPCRequest = {
    /**
     * The protocol version, always `'2.0'`.
     */
    jsonrpc: '2.0'
    /**
     * The method, mapped to the service action's pattern (see `JSONRPCMappingOptions`).
     */
    method: string
    /**
     * The params: by name (an object, merged into the action's input), or by position (an array, accepted only with the
     * `positionalParams` option).
     */
    params?: Record<string, unknown> | unknown[]
    /**
     * The request id, echoed in its response; omitted for a notification.
     */
    id?: string | number | null
}

/**
 * A JSON-RPC 2.0 response, as the adapter sends it: either `result` or `error`.
 */
export type JSONRPCResponse = {
    /**
     * The protocol version, always `'2.0'`.
     */
    jsonrpc: '2.0'
    /**
     * The id of the request answered; `null` when it could not be read (a parse error, an invalid request).
     */
    id: string | number | null
    /**
     * The action's result, `null` when it returned nothing.
     */
    result?: unknown
    /**
     * The error: its code (see {@link JSONRPCErrorCode}), its message, and for an action's error the whole error object as
     * `data`.
     */
    error?: { code: number, message: string, data?: unknown }
}

/**
 * How {@link jsonRPCServiceEntrypoint} maps a JSON-RPC request to a service action's pattern and input.
 */
export type JSONRPCMappingOptions = {
    /**
     * The pattern field receiving the request's method: with `'method'`, `{"method": "user.get", "params": {"id": 1}}`
     * is dispatched as `{method: 'user.get', id: 1}`, the action declared with `@ServiceAction({method: 'user.get'})`.
     * @default 'method'
     */
    methodField?: string
    /**
     * Build the pattern and the input of a request's action from its method and its params, replacing `methodField` and
     * `positionalParams`. A thrown error answers the request with `INVALID_PARAMS`.
     */
    toPattern?: (method: string, params: Record<string, unknown> | unknown[] | undefined) => Record<string, unknown>
    /**
     * The input field receiving the params given by position (an array): with `'args'`, `{"method": "sum", "params":
     * [1, 2]}` is dispatched as `{method: 'sum', args: [1, 2]}`.
     * @default none: the params by position are refused with `INVALID_PARAMS`
     */
    positionalParams?: string
}

/**
 * The JSON-RPC request behind a service action's request, as {@link jsonRPCRequestOfContext} returns it.
 */
export type JSONRPCRequestInfo = {
    /**
     * The request's method.
     */
    method: string
    /**
     * The request's id; `undefined` for a notification (no response is sent).
     */
    id: string | number | null | undefined
    /**
     * The transport the request came through: `'http'`, `'websocket'` or `'stdio'` with `jsonRPCServiceEntrypoint`,
     * `'webrtc'` with the data channels of `webrtcServiceEntrypoint` (package `@lakutata/webrtc`).
     */
    transport: 'http' | 'websocket' | 'stdio' | 'webrtc'
}

/**
 * Get the JSON-RPC request behind a service action's request, when {@link jsonRPCServiceEntrypoint} serves it (to
 * tell a notification from a request, or read the transport).
 * @param context The service action's context (`this.context` in a controller).
 * @returns The request's method, id and transport, or `undefined` when another adapter serves the request.
 * @example
 * ```typescript
 * import {Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {jsonRPCRequestOfContext, type JSONRPCRequestInfo} from 'lakutata/adapter/jsonrpc'
 *
 * class LogController extends Controller {
 *     //{"jsonrpc": "2.0", "method": "log.write", "params": {"line": "started"}}: a notification, no id
 *     @ServiceAction({method: 'log.write'})
 *     public async write(input: {line: string}): Promise<void> {
 *         const request: JSONRPCRequestInfo | undefined = jsonRPCRequestOfContext(this.context as ServiceContext)
 *         console.log(`${request?.transport}: ${input.line}`)
 *     }
 * }
 * ```
 */
export function jsonRPCRequestOfContext(context: ServiceContext): JSONRPCRequestInfo | undefined {
    return (context as ServiceContext & { jsonrpc?: JSONRPCRequestInfo }).jsonrpc
}

/**
 * An error of JSON-RPC
 * @param id
 * @param code
 * @param message
 * @param data
 */
function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JSONRPCResponse {
    return {jsonrpc: '2.0', id: id, error: {code: code, message: message, ...data === undefined ? {} : {data: data}}}
}

/**
 * The code of an error of an action
 * @param error
 */
function errorCode(error: unknown): number {
    if (error instanceof ControllerActionNotFoundException) return JSONRPCErrorCode.METHOD_NOT_FOUND
    if (error instanceof InvalidValueException) return JSONRPCErrorCode.INVALID_PARAMS
    if (error instanceof EntrypointStoppedException) return JSONRPCErrorCode.STOPPING
    return JSONRPCErrorCode.SERVER_ERROR
}

/**
 * Where the requests of a message are dispatched, and what their contexts get ({@link JSONRPCProtocol.handle}).
 */
export type JSONRPCDispatch = {
    /**
     * The runtime of the adapter's service channel, dispatching the requests to the actions.
     */
    runtime: ChannelRuntime<ServiceContext>
    /**
     * The transport the message came through, given to the actions by {@link jsonRPCRequestOfContext}.
     */
    transport: JSONRPCRequestInfo['transport']
    /**
     * The id of the client that sent the message, set as the contexts' `clientId`.
     */
    clientId?: string
    /**
     * The properties added to the contexts (the request of HTTP, the socket), read by the adapter's helpers.
     */
    extra?: Record<string, unknown>
    /**
     * Aborts the requests of the message (their client went away).
     */
    signal?: AbortSignal
    /**
     * Whether the adapter is stopping: the requests are then answered with `STOPPING` instead of being dispatched.
     */
    stopping: () => boolean
}

/**
 * The messages of JSON-RPC 2.0 dispatched to the service actions, for the adapters carrying JSON-RPC over their own
 * transport (as `jsonRPCServiceEntrypoint` does over HTTP, WebSocket and stdio): the single requests, the batches and
 * the notifications (run without a response). A request's method is given to the action's pattern as the options say
 * (see {@link JSONRPCMappingOptions}); its error is answered with a code of {@link JSONRPCErrorCode} and the whole
 * error object as `data`.
 * @example
 * ```typescript
 * import {createInterface} from 'node:readline'
 * import {type EntrypointAdapter, type ServiceContext} from 'lakutata/com/entrypoint'
 * import {JSONRPCProtocol, ServiceChannel, type ChannelRuntime} from '@lakutata/entrypoint/channel'
 *
 * //A service adapter reading one JSON-RPC message per line of a stream, and pushing the events to it
 * function lineServiceEntrypoint(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): EntrypointAdapter<ServiceContext> {
 *     const protocol: JSONRPCProtocol = new JSONRPCProtocol({methodField: 'method'})
 *     let stopping: boolean = false
 *     return {
 *         channel: 'service',
 *         definition: ServiceChannel,
 *         start: (runtime: ChannelRuntime<ServiceContext>): void => {
 *             createInterface({input: input}).on('line', async (line: string): Promise<void> => {
 *                 const response: unknown = await protocol.handle(line, {runtime: runtime, transport: 'stdio', stopping: (): boolean => stopping})
 *                 if (response) output.write(`${JSON.stringify(response)}\n`)
 *             })
 *         },
 *         stop: (): void => {
 *             stopping = true
 *         },
 *         broadcast: (event: string, args: unknown[]): number => {
 *             output.write(`${JSONRPCProtocol.notification(event, args)}\n`)
 *             return 1
 *         }
 *     }
 * }
 * ```
 */
export class JSONRPCProtocol {

    /**
     * Create the protocol of an adapter.
     * @param options How the requests map to the actions' patterns.
     */
    constructor(protected readonly options: JSONRPCMappingOptions = {}) {
    }

    /**
     * Build the pattern and the input of a request's action.
     * @param request The request.
     * @returns The data of the request's service context.
     * @throws {Error} When the params are given by position without the `positionalParams` option (answered with
     * `INVALID_PARAMS`), or the error of the `toPattern` option.
     * @protected
     */
    protected pattern(request: JSONRPCRequest): Record<string, unknown> {
        if (this.options.toPattern) return this.options.toPattern(request.method, request.params)
        const field: string = this.options.methodField ?? 'method'
        if (Array.isArray(request.params)) {
            if (!this.options.positionalParams) throw Object.assign(new Error('The params by position are not accepted: give them by name (an object)'), {jsonrpcCode: JSONRPCErrorCode.INVALID_PARAMS})
            return {[this.options.positionalParams]: request.params, [field]: request.method}
        }
        return {...request.params ?? {}, [field]: request.method}
    }

    /**
     * Dispatch a request of a message to its action.
     * @param request The request, as parsed.
     * @param dispatch Where it is dispatched.
     * @returns Its response, `undefined` for a notification.
     * @protected
     */
    protected async one(request: unknown, dispatch: JSONRPCDispatch): Promise<JSONRPCResponse | undefined> {
        const candidate = request as Partial<JSONRPCRequest>
        const id: string | number | null = typeof candidate?.id === 'string' || typeof candidate?.id === 'number' ? candidate.id : null
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string'
            || (candidate.params !== undefined && (candidate.params === null || typeof candidate.params !== 'object'))
            || (candidate.id !== undefined && candidate.id !== null && typeof candidate.id !== 'string' && typeof candidate.id !== 'number')) {
            return errorResponse(id, JSONRPCErrorCode.INVALID_REQUEST, 'The request is not a request of JSON-RPC 2.0')
        }
        const notification: boolean = !('id' in candidate)
        const respond = (response: JSONRPCResponse): JSONRPCResponse | undefined => notification ? undefined : response
        if (dispatch.stopping()) return respond(errorResponse(id, JSONRPCErrorCode.STOPPING, 'The entrypoint is stopping'))
        let data: Record<string, unknown>
        try {
            data = this.pattern(candidate as JSONRPCRequest)
        } catch (error: unknown) {
            return respond(errorResponse(id, (error as { jsonrpcCode?: number }).jsonrpcCode ?? JSONRPCErrorCode.INVALID_PARAMS, (error as Error).message))
        }
        try {
            const context: ServiceContext = new ServiceContext({
                data: data,
                clientId: dispatch.clientId,
                jsonrpc: {method: candidate.method, id: candidate.id, transport: dispatch.transport},
                ...dispatch.extra ?? {}
            })
            //A StatusResult sent as its data (a file or an event stream cannot be sent: an error)
            const result: unknown = ServiceResponseCodec.payload(await dispatch.runtime.dispatch(context, {signal: dispatch.signal}))
            return respond({jsonrpc: '2.0', id: id, result: result === undefined ? null : result})
        } catch (error: unknown) {
            //The error of the action: its message, the whole error as its data (as the other service adapters give it)
            return respond(errorResponse(id, errorCode(error), (error as Error)?.message || String(error), ServiceResponseCodec.encodeError(error).error))
        }
    }

    /**
     * Dispatch the requests of a message (a request, or a batch of them) and build its response.
     * @param message The message's text.
     * @param dispatch Where the requests are dispatched, and what their contexts get.
     * @returns The response to send (an array for a batch), or `undefined` when there is none (only notifications).
     * A message that is not JSON, or not a request, is answered with an error response.
     * @example
     * ```typescript
     * import type {ServiceContext} from 'lakutata/com/entrypoint'
     * import {JSONRPCProtocol, type ChannelRuntime} from '@lakutata/entrypoint/channel'
     *
     * declare const runtime: ChannelRuntime<ServiceContext>
     * const protocol: JSONRPCProtocol = new JSONRPCProtocol()
     * //{jsonrpc: '2.0', id: 1, result: …}
     * const response: unknown = await protocol.handle('{"jsonrpc": "2.0", "id": 1, "method": "user.get", "params": {"id": 7}}', {
     *     runtime: runtime,
     *     transport: 'websocket',
     *     clientId: 'client-1',
     *     stopping: (): boolean => false
     * })
     * ```
     */
    public async handle(message: string, dispatch: JSONRPCDispatch): Promise<JSONRPCResponse | JSONRPCResponse[] | undefined> {
        let parsed: unknown
        try {
            parsed = JSON.parse(message)
        } catch {
            return errorResponse(null, JSONRPCErrorCode.PARSE_ERROR, 'The message is not JSON')
        }
        if (!Array.isArray(parsed)) return await this.one(parsed, dispatch)
        if (!parsed.length) return errorResponse(null, JSONRPCErrorCode.INVALID_REQUEST, 'The batch is empty')
        const responses: (JSONRPCResponse | undefined)[] = await Promise.all(parsed.map((request: unknown): Promise<JSONRPCResponse | undefined> => this.one(request, dispatch)))
        const answered: JSONRPCResponse[] = responses.filter((response: JSONRPCResponse | undefined): response is JSONRPCResponse => !!response)
        return answered.length ? answered : undefined
    }

    /**
     * Build the notification pushing an event to a client: `{"jsonrpc": "2.0", "method": <event>, "params": <args>}`.
     * @param event The event's name.
     * @param args The event's arguments.
     * @returns The notification's text.
     * @example
     * ```typescript
     * import {JSONRPCProtocol} from '@lakutata/entrypoint/channel'
     *
     * //{"jsonrpc":"2.0","method":"progress","params":[50]}
     * console.log(JSONRPCProtocol.notification('progress', [50]))
     * ```
     */
    public static notification(event: string, args: unknown[]): string {
        return JSON.stringify({jsonrpc: '2.0', method: event, params: args})
    }
}
