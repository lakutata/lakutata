/**
 * Wait for a time before resolving, without blocking the event loop (a promise of `setTimeout`). The wait cannot be
 * cancelled.
 * @param ms The time to wait, in milliseconds. A negative or `NaN` value is taken as `0` (the next turn of the event
 * loop); as for `setTimeout`, a value above 2147483647 waits 1 millisecond (Node.js prints a warning).
 * @returns A promise resolved with `undefined` once the time has passed; it never rejects.
 * @example
 * ```typescript
 * import {Delay} from 'lakutata/utils'
 *
 * const start: number = Date.now()
 * await Delay(500)
 * console.log(Date.now() - start >= 500)
 * //true
 * ```
 */
export async function Delay(ms: number): Promise<void> {
    //Not given to setTimeout as is: Node.js warns for a negative or NaN delay
    const delay: number = ms > 0 ? ms : 0
    return new Promise(resolve => setTimeout(() => resolve(), delay))
}
