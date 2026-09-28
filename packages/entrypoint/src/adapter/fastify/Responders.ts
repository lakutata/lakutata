import type {FastifyReply, FastifyRequest} from 'fastify'
import {DescribeError, StatusOfError} from '../../lib/HTTPErrors.js'

/**
 * How the results and the errors of the actions are written
 */
export interface FastifyResponder {
    /**
     * Write the result of an action
     * @param reply
     * @param data
     * @param request
     */
    success(reply: FastifyReply, data: unknown, request: FastifyRequest): void

    /**
     * Write an error
     * @param reply
     * @param error
     * @param request
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
 * The results as JSON (204 without result), the errors as {errno, errMsg} with their status
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

export type FastifyJSONEnvelopeOptions = {
    /**
     * The status of the errors, their own status by default
     */
    errorStatus?: number
}

/**
 * The results and the errors in an envelope: {errno, errMsg, data}
 * @param options
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
