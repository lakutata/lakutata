/**
 * Is abort error
 * @param error
 * @constructor
 */
export function IsAbortError(error: Error | any): boolean {
    return error.code === 'ABORT_ERR'
}
