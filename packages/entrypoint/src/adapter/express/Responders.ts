import type {Request, Response} from 'express'
import {describeError, type HTTPErrorOrigin, statusOfError} from '../../lib/HTTPErrors.js'
import {envelopeOf, errorExtraOf} from '../../lib/Envelope.js'

export {describeError, statusOfError, type HTTPErrorOrigin}

/**
 * How {@link expressHTTPEntrypoint} writes the results and the errors of the actions (its `respond` option). Implement
 * it to give the responses another shape; {@link JSONResponder} is the default, {@link jsonEnvelope} wraps them in an
 * envelope. The file results and the event streams are not written by the responder.
 */
export interface ExpressResponder {
    /**
     * Write the result of an action. For a `StatusResult`, its status and headers are already set on the response and
     * `data` is its payload.
     * @param response The express response to write.
     * @param data The action's result, `undefined` when it returned nothing.
     * @param request The express request being answered.
     */
    success(response: Response, data: unknown, request: Request): void

    /**
     * Write an error: a failed action (validation, access control, its own exception), an error passed by an express
     * middleware (`next(error)`: an authenticator), or a request matching no route (`RouteNotFoundException`). Not
     * called once the response headers are sent, nor after the client left.
     * @param response The express response to write.
     * @param error The thrown error.
     * @param request The express request being answered.
     * @param origin Where the error comes from: `'action'` (the dispatch of an action failed) or `'request'` (an
     * express middleware, a route not found); see {@link HTTPErrorOrigin}.
     */
    error(response: Response, error: unknown, request: Request, origin?: HTTPErrorOrigin): void
}

/**
 * The default responder of {@link expressHTTPEntrypoint}: a result is sent as JSON, no result as an empty 204 (or the
 * status set by a `StatusResult`); an error is sent as `{errno, errMsg}` (see `describeError`) with its HTTP status
 * (see `statusOfError`: the first 4xx status in its cause chain, its own status, or 500).
 */
export const JSONResponder: ExpressResponder = {
    success: (response: Response, data: unknown): void => {
        if (data === undefined) {
            response.status(response.statusCode === 200 ? 204 : response.statusCode).end()
            return
        }
        response.json(data)
    },
    error: (response: Response, error: unknown): void => {
        response.status(statusOfError(error)).json(describeError(error))
    }
}

/**
 * The options of {@link jsonEnvelope}.
 */
export type JSONEnvelopeOptions = {
    /**
     * The HTTP status of every error response, such as 200 for the clients that read the errors from the envelope.
     * @default the error's own status (see `statusOfError`)
     */
    errorStatus?: number
    /**
     * The HTTP status of the errors of the actions only (their dispatch failed: validation, access control, their own
     * exceptions), over `errorStatus`; the errors of the express middlewares (an authenticator's 401) and the routes
     * not found keep theirs. 200 answers as the applications of lakutata 2.x usually did.
     * @default `errorStatus`
     */
    actionErrorStatus?: number
    /**
     * The extra fields of the envelope, such as the `timestamp`, `nonce` or `requestId` of the envelopes of the
     * applications of lakutata 2.x: called for each response (a result or an error), its fields added after `errno`,
     * `errMsg` and `data`, which they never replace. When it throws, a result is answered as an error, and an error
     * without the extra fields.
     * @param request The express request being answered.
     * @returns The fields to add to the envelope.
     * @default no extra field
     */
    extra?: (request: Request) => Record<string, unknown>
}

/**
 * Create a responder for {@link expressHTTPEntrypoint} that wraps every response in the envelope
 * `{errno, errMsg, data}`: a result as `{errno: null, errMsg: null, data}` (`data` is `null` when the action returned
 * nothing, and its status is not turned into 204), an error as `{errno, errMsg, data: null}` with the error's status,
 * the `errorStatus` option, or for the errors of the actions the `actionErrorStatus` option; the `extra` option adds
 * fields to both.
 * @param options The envelope options.
 * @returns The responder, to give to the `respond` option of `expressHTTPEntrypoint`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 * import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
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
 *             //found and the errors of the express middlewares with their status (404, 401…); every envelope with
 *             //its timestamp ({"errno": null, "errMsg": null, "data": "pong", "timestamp": 1767225600000})
 *             http: expressHTTPEntrypoint({
 *                 port: 8080,
 *                 respond: jsonEnvelope({
 *                     actionErrorStatus: 200,
 *                     extra: (): Record<string, unknown> => ({timestamp: Date.now()})
 *                 })
 *             })
 *         })
 *     }
 * })
 * ```
 */
export function jsonEnvelope(options: JSONEnvelopeOptions = {}): ExpressResponder {
    return {
        success: (response: Response, data: unknown, request: Request): void => {
            response.json(envelopeOf({errno: null, errMsg: null, data: data === undefined ? null : data}, options.extra?.(request)))
        },
        error: (response: Response, error: unknown, request: Request, origin?: HTTPErrorOrigin): void => {
            const status: number | undefined = origin === 'action' ? options.actionErrorStatus ?? options.errorStatus : options.errorStatus
            response.status(status ?? statusOfError(error)).json(envelopeOf({...describeError(error), data: null}, errorExtraOf(options.extra, request)))
        }
    }
}
