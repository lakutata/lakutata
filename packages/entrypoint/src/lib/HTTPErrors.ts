import {type ErrorDescription} from '../types/ErrorDescription.js'

/**
 * Where an error answered by an HTTP adapter comes from, given to the `error` of its responder: `'action'` when the
 * request reached an action and its dispatch failed (the entrypoint's middlewares, the validation of the input, the
 * access control, the action itself); `'request'` when it failed before (a middleware of the web framework such as an
 * authenticator, a hook of fastify, a body too large) or matched no route.
 * @example
 * ```typescript
 * import type {Request, Response} from 'express'
 * import {DescribeError, type ExpressResponder, type HTTPErrorOrigin, StatusOfError} from 'lakutata/adapter/express'
 *
 * //The errors of the actions answered with 200, the others with their status
 * export const responder: ExpressResponder = {
 *     success: (response: Response, data: unknown): void => void response.json({data: data}),
 *     error: (response: Response, error: unknown, _request: Request, origin?: HTTPErrorOrigin): void => {
 *         response.status(origin === 'action' ? 200 : StatusOfError(error)).json(DescribeError(error))
 *     }
 * }
 * ```
 */
export type HTTPErrorOrigin = 'action' | 'request'

/**
 * Find the HTTP status of an error, read from its `statusCode` or `status`: the first client error (4xx) found on the
 * error or along its `cause` chain, else the error's own status when it is between 400 and 599, else 500. A validation
 * failure, wrapped in an exception whose cause is the 400 validation error, thus gives 400.
 * @param error The error, any value.
 * @returns The HTTP status, from 400 to 599.
 * @example
 * ```typescript
 * import {StatusOfError} from 'lakutata/adapter/express'
 *
 * class NotFound extends Error {
 *     public readonly statusCode: number = 404
 * }
 *
 * console.log(StatusOfError(new NotFound('No such order'))) //404
 * console.log(StatusOfError(new Error('Failed', {cause: new NotFound('No such order')}))) //404
 * console.log(StatusOfError(new Error('Boom'))) //500
 * ```
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
 * Describe an error as the JSON responders send it: its `errno` (or `code`, `E_UNKNOWN` without either) and its
 * `errMsg` (or `message`, or the error converted to a string).
 * @param error The error, any value.
 * @returns The error's number and message.
 * @example
 * ```typescript
 * import {DescribeError, type ErrorDescription} from 'lakutata/adapter/express'
 *
 * const description: ErrorDescription = DescribeError(new Error('Boom'))
 * console.log(description) //{errno: 'E_UNKNOWN', errMsg: 'Boom'}
 * ```
 */
export function DescribeError(error: unknown): ErrorDescription {
    const described: any = error ?? {}
    return {
        errno: described.errno ?? described.code ?? 'E_UNKNOWN',
        errMsg: described.errMsg ?? described.message ?? String(error)
    }
}
