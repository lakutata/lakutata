import {InvalidValueException} from '@lakutata/core'
import type {ChannelRuntime} from '../../channel/EntrypointAdapter.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceResponseCodec} from '../../lib/ServiceResponseCodec.js'
import {ControllerActionNotFoundException} from '../../exceptions/ControllerActionNotFoundException.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The error codes of JSON-RPC 2.0
 */
export const JSONRPCErrorCode = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    /**
     * The errors of the actions (the range of the errors of the servers: -32000 to -32099)
     */
    SERVER_ERROR: -32000,
    /**
     * The adapter is stopping
     */
    STOPPING: -32001
} as const

/**
 * A request of JSON-RPC 2.0 (a notification without its id)
 */
export type JSONRPCRequest = {
    jsonrpc: '2.0'
    method: string
    params?: Record<string, unknown> | unknown[]
    id?: string | number | null
}

/**
 * A response of JSON-RPC 2.0
 */
export type JSONRPCResponse = {
    jsonrpc: '2.0'
    id: string | number | null
    result?: unknown
    error?: { code: number, message: string, data?: unknown }
}

/**
 * The options of the mapping of the requests to the service actions
 */
export type JSONRPCMappingOptions = {
    /**
     * The field of the pattern of the actions given the method of a request, "method" by default:
     * {"method": "user.get", "params": {"id": 1}} is dispatched as {method: 'user.get', id: 1}
     */
    methodField?: string
    /**
     * The pattern and the input of the action of a request (its method, its params), instead of the field of its method
     */
    toPattern?: (method: string, params: Record<string, unknown> | unknown[] | undefined) => Record<string, unknown>
    /**
     * The field given the params of a request by position (an array): refused by default (invalid params)
     */
    positionalParams?: string
}

/**
 * The information of the request of JSON-RPC of a context
 */
export type JSONRPCRequestInfo = {
    method: string
    id: string | number | null | undefined
    transport: 'http' | 'websocket' | 'stdio'
}

/**
 * The request of JSON-RPC of a context, in the service actions served by JSONRPCServiceEntrypoint
 * @param context
 */
export function JSONRPCRequestOfContext(context: ServiceContext): JSONRPCRequestInfo | undefined {
    return (context as ServiceContext & { jsonrpc?: JSONRPCRequestInfo }).jsonrpc
}

/**
 * An error of JSON-RPC
 * @param id
 * @param code
 * @param message
 * @param data
 */
function ErrorResponse(id: string | number | null, code: number, message: string, data?: unknown): JSONRPCResponse {
    return {jsonrpc: '2.0', id: id, error: {code: code, message: message, ...data === undefined ? {} : {data: data}}}
}

/**
 * The code of an error of an action
 * @param error
 */
function ErrorCode(error: unknown): number {
    if (error instanceof ControllerActionNotFoundException) return JSONRPCErrorCode.METHOD_NOT_FOUND
    if (error instanceof InvalidValueException) return JSONRPCErrorCode.INVALID_PARAMS
    if (error instanceof EntrypointStoppedException) return JSONRPCErrorCode.STOPPING
    return JSONRPCErrorCode.SERVER_ERROR
}

/**
 * The context of a dispatch of a request
 */
export type JSONRPCDispatch = {
    runtime: ChannelRuntime<ServiceContext>
    transport: JSONRPCRequestInfo['transport']
    clientId?: string
    /**
     * The properties added to the contexts (the request of HTTP, the socket)
     */
    extra?: Record<string, unknown>
    signal?: AbortSignal
    stopping: () => boolean
}

/**
 * The requests of JSON-RPC 2.0 dispatched to the service actions: the single ones, the batches, the notifications (no
 * response); their methods given to the patterns of the actions
 */
export class JSONRPCProtocol {

    constructor(protected readonly options: JSONRPCMappingOptions = {}) {
    }

    /**
     * The pattern and the input of the action of a request
     * @param request
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
     * The response of a request (none for a notification)
     * @param request
     * @param dispatch
     * @protected
     */
    protected async one(request: unknown, dispatch: JSONRPCDispatch): Promise<JSONRPCResponse | undefined> {
        const candidate = request as Partial<JSONRPCRequest>
        const id: string | number | null = typeof candidate?.id === 'string' || typeof candidate?.id === 'number' ? candidate.id : null
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string'
            || (candidate.params !== undefined && (candidate.params === null || typeof candidate.params !== 'object'))
            || (candidate.id !== undefined && candidate.id !== null && typeof candidate.id !== 'string' && typeof candidate.id !== 'number')) {
            return ErrorResponse(id, JSONRPCErrorCode.INVALID_REQUEST, 'The request is not a request of JSON-RPC 2.0')
        }
        const notification: boolean = !('id' in candidate)
        const respond = (response: JSONRPCResponse): JSONRPCResponse | undefined => notification ? undefined : response
        if (dispatch.stopping()) return respond(ErrorResponse(id, JSONRPCErrorCode.STOPPING, 'The entrypoint is stopping'))
        let data: Record<string, unknown>
        try {
            data = this.pattern(candidate as JSONRPCRequest)
        } catch (error: unknown) {
            return respond(ErrorResponse(id, (error as { jsonrpcCode?: number }).jsonrpcCode ?? JSONRPCErrorCode.INVALID_PARAMS, (error as Error).message))
        }
        try {
            const context: ServiceContext = new ServiceContext({
                data: data,
                clientId: dispatch.clientId,
                jsonrpc: {method: candidate.method, id: candidate.id, transport: dispatch.transport},
                ...dispatch.extra ?? {}
            })
            const result: unknown = await dispatch.runtime.dispatch(context, {signal: dispatch.signal})
            return respond({jsonrpc: '2.0', id: id, result: result === undefined ? null : result})
        } catch (error: unknown) {
            //The error of the action: its message, the whole error as its data (as the other service adapters give it)
            return respond(ErrorResponse(id, ErrorCode(error), (error as Error)?.message || String(error), ServiceResponseCodec.encodeError(error).error))
        }
    }

    /**
     * The response of a message (a request, a batch): undefined when there is none (notifications)
     * @param message its text
     * @param dispatch
     */
    public async handle(message: string, dispatch: JSONRPCDispatch): Promise<JSONRPCResponse | JSONRPCResponse[] | undefined> {
        let parsed: unknown
        try {
            parsed = JSON.parse(message)
        } catch {
            return ErrorResponse(null, JSONRPCErrorCode.PARSE_ERROR, 'The message is not JSON')
        }
        if (!Array.isArray(parsed)) return await this.one(parsed, dispatch)
        if (!parsed.length) return ErrorResponse(null, JSONRPCErrorCode.INVALID_REQUEST, 'The batch is empty')
        const responses: (JSONRPCResponse | undefined)[] = await Promise.all(parsed.map((request: unknown): Promise<JSONRPCResponse | undefined> => this.one(request, dispatch)))
        const answered: JSONRPCResponse[] = responses.filter((response: JSONRPCResponse | undefined): response is JSONRPCResponse => !!response)
        return answered.length ? answered : undefined
    }

    /**
     * A notification sent to a client (an event pushed)
     * @param event
     * @param args
     */
    public static notification(event: string, args: unknown[]): string {
        return JSON.stringify({jsonrpc: '2.0', method: event, params: args})
    }
}
