import type {FastifyReply, FastifyRequest} from 'fastify'
import {DescribeError, StatusOfError} from '../../lib/HTTPErrors.js'

/**
 * How {@link FastifyHTTPEntrypoint} writes the results and the errors of the actions (its `respond` option). Implement
 * it to give the responses another shape; {@link FastifyJSONResponder} is the default, {@link FastifyJSONEnvelope}
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
     * Write an error: a failed action (validation, access control, its own exception), an error of fastify (a body too
     * large), or a request matching no route (`RouteNotFoundException`). Not called for an action once the reply is
     * sent, nor after the client left.
     * @param reply The fastify reply to send.
     * @param error The thrown error.
     * @param request The fastify request being answered.
     */
    error(reply: FastifyReply, error: unknown, request: FastifyRequest): void
}

/**
 * Send JSON
 * @param reply
 * @param data
 */
function SendJSON(reply: FastifyReply, data: unknown): void {
    reply.type('application/json; charset=utf-8').send(JSON.stringify(data))
}

/**
 * The default responder of {@link FastifyHTTPEntrypoint}: a result is sent as JSON, no result as an empty 204 (or the
 * status set by a `StatusResult`); an error is sent as `{errno, errMsg}` (see `DescribeError`) with its HTTP status
 * (see `StatusOfError`: the first 4xx status in its cause chain, its own status, or 500).
 */
export const FastifyJSONResponder: FastifyResponder = {
    success: (reply: FastifyReply, data: unknown): void => {
        if (data === undefined) {
            reply.code(reply.statusCode === 200 ? 204 : reply.statusCode).send()
            return
        }
        SendJSON(reply, data)
    },
    error: (reply: FastifyReply, error: unknown): void => {
        reply.code(StatusOfError(error))
        SendJSON(reply, DescribeError(error))
    }
}

/**
 * The options of {@link FastifyJSONEnvelope}.
 */
export type FastifyJSONEnvelopeOptions = {
    /**
     * The HTTP status of every error response, such as 200 for the clients that read the errors from the envelope.
     * @default the error's own status (see `StatusOfError`)
     */
    errorStatus?: number
}

/**
 * Create a responder for {@link FastifyHTTPEntrypoint} that wraps every response in the envelope
 * `{errno, errMsg, data}`: a result as `{errno: null, errMsg: null, data}` (`data` is `null` when the action returned
 * nothing, and its status is not turned into 204), an error as `{errno, errMsg, data: null}` with the error's status or
 * the `errorStatus` option.
 * @param options The envelope options.
 * @returns The responder, to give to the `respond` option of `FastifyHTTPEntrypoint`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 * import {FastifyHTTPEntrypoint, FastifyJSONEnvelope} from 'lakutata/adapter/fastify'
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
 *         entrypoint: BuildEntrypoints({
 *             controllers: [PingController],
 *             //The errors answered with 200 too: {"errno": "E_ROUTE_NOT_FOUND", "errMsg": "…", "data": null}
 *             http: FastifyHTTPEntrypoint({port: 8080, respond: FastifyJSONEnvelope({errorStatus: 200})})
 *         })
 *     }
 * })
 * ```
 */
export function FastifyJSONEnvelope(options: FastifyJSONEnvelopeOptions = {}): FastifyResponder {
    return {
        success: (reply: FastifyReply, data: unknown): void => SendJSON(reply, {errno: null, errMsg: null, data: data === undefined ? null : data}),
        error: (reply: FastifyReply, error: unknown): void => {
            reply.code(options.errorStatus ?? StatusOfError(error))
            SendJSON(reply, {...DescribeError(error), data: null})
        }
    }
}
