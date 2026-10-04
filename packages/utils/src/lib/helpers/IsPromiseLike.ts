/**
 * Tell whether a value is promise-like: a thenable, an object or a function with a `then` method, which `await` waits
 * for (a `Promise` included). The `then` method is not called. Use {@link IsPromise} for the real promises only.
 * @param target The value to test, of any type.
 * @returns `true` when the value has a `then` method, `false` otherwise (`null` and `undefined` included).
 * @example
 * ```typescript
 * import {IsPromiseLike} from 'lakutata/utils'
 *
 * console.log(IsPromiseLike(Promise.resolve(1)), IsPromiseLike({then: (): void => undefined}), IsPromiseLike(null))
 * //true true false
 * ```
 */
export function IsPromiseLike(target: any): boolean {
    return (typeof target === 'object' || typeof target === 'function') && target !== null && typeof target.then === 'function'
}
