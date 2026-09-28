import type {Request, Response} from 'express'

/**
 * How an adapter writes the results and the errors of the actions
 * The status and the headers of a StatusResult are set before success() is called
 */
export interface ExpressResponder {
    success(response: Response, data: unknown, request: Request): void

    error(response: Response, error: unknown, request: Request): void
}

/**
 * The HTTP status of an error: the first client error (4xx) of its causes, its own status, or 500
 * (a validation failure is wrapped in an exception whose cause is the 400 validation error)
 * @param error
 */
export function StatusOfError(error: unknown): number {
    for (let current: any = error; current && typeof current === 'object'; current = current.cause) {
        const status: unknown = current.statusCode ?? current.status
        if (typeof status === 'number' && status >= 400 && status < 500) return status
    }
    const status: unknown = (error as any)?.statusCode ?? (error as any)?.status
    return typeof status === 'number' && status >= 400 && status < 600 ? status : 500
}

/**
 * The error number and message of an error
 * @param error
 */
export function DescribeError(error: unknown): { errno: string | number, errMsg: string } {
    const described: any = error ?? {}
    return {
        errno: described.errno ?? described.code ?? 'E_UNKNOWN',
        errMsg: described.errMsg ?? described.message ?? String(error)
    }
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
