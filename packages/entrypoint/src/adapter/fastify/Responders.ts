import type {FastifyReply, FastifyRequest} from 'fastify'
import {describeError, type HTTPErrorOrigin, statusOfError} from '../../lib/HTTPErrors.js'
import {envelopeOf, errorExtraOf} from '../../lib/Envelope.js'

/**
 * How {@link fastifyHTTPEntrypoint} writes the results and the errors of the actions (its `respond` option). Implement
 * it to give the responses another shape; {@link FastifyJSONResponder} is the default, {@link fastifyJSONEnvelope}
 * wraps them in an envelope. The file results and the event streams are not written by the responder.
 */
export interface FastifyResponder {
    /**
     * Write the result of an action. For a `StatusResult`, its status and headers are already set on the reply and
     * `data` is its payload.
     * @param reply The fastify reply to send.
     * @param data The action's result, `undefined` when it returned nothing.
     * @param request The fastify request being answered.
     */
    success(reply: FastifyReply, data: unknown, request: FastifyRequest): void

    /**
     * Write an error: a failed action (validation, access control, its own exception), an error of fastify (a hook such
     * as an authenticator, a body too large), or a request matching no route (`RouteNotFoundException`). Not called for
     * an action once the reply is sent, nor after the client left.
     * @param reply The fastify reply to send.
     * @param error The thrown error.
     * @param request The fastify request being answered.
     * @param origin Where the error comes from: `'action'` (the dispatch of an action failed) or `'request'` (a hook,
     * an error of fastify, a route not found); see `HTTPErrorOrigin`.
     */
    error(reply: FastifyReply, error: unknown, request: FastifyRequest, origin?: HTTPErrorOrigin): void
}

/**
 * Send JSON
 * @param reply
 * @param data
 */
function sendJSON(reply: FastifyReply, data: unknown): void {
    reply.type('application/json; charset=utf-8').send(JSON.stringify(data))
}

/**
 * The default responder of {@link fastifyHTTPEntrypoint}: a result is sent as JSON, no result as an empty 204 (or the
 * status set by a `StatusResult`); an error is sent as `{errno, errMsg}` (see `describeError`) with its HTTP status
 * (see `statusOfError`: the first 4xx status in its cause chain, its own status, or 500).
 */
export const FastifyJSONResponder: FastifyResponder = {
    success: (reply: FastifyReply, data: unknown): void => {
        if (data === undefined) {
            reply.code(reply.statusCode === 200 ? 204 : reply.statusCode).send()
            return
        }
        sendJSON(reply, data)
    },
    error: (reply: FastifyReply, error: unknown): void => {
        reply.code(statusOfError(error))
        sendJSON(reply, describeError(error))
    }
}

/**
 * The options of {@link fastifyJSONEnvelope}.
 */
export type FastifyJSONEnvelopeOptions = {
    /**
     * The HTTP status of every error response, such as 200 for the clients that read the errors from the envelope.
     * @default the error's own status (see `statusOfError`)
     */
    errorStatus?: number
    /**
     * The HTTP status of the errors of the actions only (their dispatch failed: validation, access control, their own
     * exceptions), over `errorStatus`; the errors of the hooks (an authenticator's 401), of fastify and the routes not
     * found keep theirs. 200 answers as the applications of lakutata 2.x usually did.
     * @default `errorStatus`
     */
    actionErrorStatus?: number
    /**
     * The extra fields of the envelope, such as the `timestamp`, `nonce` or `requestId` of the envelopes of the
     * applications of lakutata 2.x: called for each response (a result or an error), its fields added after `errno`,
     * `errMsg` and `data`, which they never replace. When it throws, a result is answered as an error, and an error
     * without the extra fields.
     * @param request The fastify request being answered.
     * @returns The fields to add to the envelope.
     * @default no extra field
     */
    extra?: (request: FastifyRequest) => Record<string, unknown>
}

/**
 * Create a responder for {@link fastifyHTTPEntrypoint} that wraps every response in the envelope
 * `{errno, errMsg, data}`: a result as `{errno: null, errMsg: null, data}` (`data` is `null` when the action returned
 * nothing, and its status is not turned into 204), an error as `{errno, errMsg, data: null}` with the error's status,
 * the `errorStatus` option, or for the errors of the actions the `actionErrorStatus` option; the `extra` option adds
 * fields to both.
 * @param options The envelope options.
 * @returns The responder, to give to the `respond` option of `fastifyHTTPEntrypoint`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 * import {fastifyHTTPEntrypoint, fastifyJSONEnvelope} from 'lakutata/adapter/fastify'
 *
 * class PingController extends Controller {
 *     //GET /ping answers {"errno": null, "errMsg": null, "data": "pong"}
 *     @GET('/ping')
 *     public async ping(): Promise<string> {
 *         return 'pong'
 *     }
 * }
 *
 * Application.run({
 *     id: 'web.app',
 *     name: 'Web',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [PingController],
 *             //The errors of the actions answered with 200 too (as the applications of lakutata 2.x), the routes not
 *             //found and the errors of the hooks with their status (404, 401…); every envelope with
 *             //its timestamp ({"errno": null, "errMsg": null, "data": "pong", "timestamp": 1767225600000})
 *             http: fastifyHTTPEntrypoint({
 *                 port: 8080,
 *                 respond: fastifyJSONEnvelope({
 *                     actionErrorStatus: 200,
 *                     extra: (): Record<string, unknown> => ({timestamp: Date.now()})
 *                 })
 *             })
 *         })
 *     }
 * })
 * ```
 */
export function fastifyJSONEnvelope(options: FastifyJSONEnvelopeOptions = {}): FastifyResponder {
    return {
        success: (reply: FastifyReply, data: unknown, request: FastifyRequest): void => sendJSON(reply, envelopeOf({errno: null, errMsg: null, data: data === undefined ? null : data}, options.extra?.(request))),
        error: (reply: FastifyReply, error: unknown, request: FastifyRequest, origin?: HTTPErrorOrigin): void => {
            const status: number | undefined = origin === 'action' ? options.actionErrorStatus ?? options.errorStatus : options.errorStatus
            reply.code(status ?? statusOfError(error))
            sendJSON(reply, envelopeOf({...describeError(error), data: null}, errorExtraOf(options.extra, request)))
        }
    }
}
