import type {Request, Response} from 'express'
import {DescribeError, StatusOfError} from '../../lib/HTTPErrors.js'

export {DescribeError, StatusOfError}

/**
 * How an adapter writes the results and the errors of the actions
 * The status and the headers of a StatusResult are set before success() is called
 */
export interface ExpressResponder {
    success(response: Response, data: unknown, request: Request): void

    error(response: Response, error: unknown, request: Request): void
}

/**
 * The default responder: the data as JSON (no content when undefined), the errors as {errno, errMsg} with their status
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
        response.status(StatusOfError(error)).json(DescribeError(error))
    }
}

export type JSONEnvelopeOptions = {
    /**
     * The status of the error responses, the status of the error when omitted
     */
    errorStatus?: number
}

/**
 * A responder wrapping the results and the errors in an envelope: {errno, errMsg, data}
 * @param options
 */
export function JSONEnvelope(options: JSONEnvelopeOptions = {}): ExpressResponder {
    return {
        success: (response: Response, data: unknown): void => {
            response.json({errno: null, errMsg: null, data: data === undefined ? null : data})
        },
        error: (response: Response, error: unknown): void => {
            response.status(options.errorStatus ?? StatusOfError(error)).json({...DescribeError(error), data: null})
        }
    }
}
