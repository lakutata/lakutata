/**
 * Tell whether an error is an abort error: the `DOMException` (or any error) named `AbortError`, which
 * `AbortController.abort()` gives as its reason without argument and an aborted `fetch` rejects with, or an error of a
 * Node.js API with the code `'ABORT_ERR'` (an aborted `node:timers/promises`, `node:fs/promises`, `node:child_process`,
 * `events.once`…). The reason of `AbortSignal.timeout()`, a `TimeoutError`, is not an abort error.
 * @param error The caught value, of any type.
 * @returns `true` when `error.name` is `'AbortError'` or `error.code` is `'ABORT_ERR'`, `false` otherwise (`null` and
 * `undefined` included).
 * @example
 * ```typescript
 * import {setTimeout as sleep} from 'node:timers/promises'
 * import {isAbortError} from 'lakutata/utils'
 *
 * try {
 *     await sleep(1000, undefined, {signal: AbortSignal.timeout(10)})
 * } catch (error) {
 *     console.log(isAbortError(error))
 *     //true
 * }
 * const controller: AbortController = new AbortController()
 * controller.abort()
 * console.log(isAbortError(controller.signal.reason), isAbortError(undefined))
 * //true false
 * ```
 */
export function isAbortError(error: Error | any): boolean {
    if (error === null || error === undefined) return false
    return error.name === 'AbortError' || error.code === 'ABORT_ERR'
}
