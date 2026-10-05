import {isPromise as isBuiltinPromises} from 'util/types'

/**
 * Tell whether a value is a real promise: an instance of `Promise` (or of a subclass), or a native promise of another
 * realm (a `node:vm` context, a worker's message). A thenable which is not a promise (an object with a `then` method)
 * is not one: test it with {@link isPromiseLike}. An async function is not a promise, the promise it returns is.
 * @param target The value to test, of any type.
 * @returns `true` when the value is a promise, `false` otherwise (`null` and `undefined` included).
 * @example
 * ```typescript
 * import {isPromise} from 'lakutata/utils'
 *
 * console.log(isPromise(Promise.resolve(1)), isPromise({then: (): void => undefined}), isPromise(1))
 * //true false false
 * ```
 */
export function isPromise(target: any): boolean {
    return target instanceof Promise || isBuiltinPromises(target)
}
