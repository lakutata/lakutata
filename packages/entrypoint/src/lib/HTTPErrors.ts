import {type ErrorDescription} from '../types/ErrorDescription.js'

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
export function DescribeError(error: unknown): ErrorDescription {
    const described: any = error ?? {}
    return {
        errno: described.errno ?? described.code ?? 'E_UNKNOWN',
        errMsg: described.errMsg ?? described.message ?? String(error)
    }
}
