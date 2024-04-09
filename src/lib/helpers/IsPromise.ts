import {isPromise as isBuiltinPromises} from 'util/types'

/**
 * Whether an object is Promise object or not
 * @param target
 */
export function IsPromise(target: any): boolean {
    return isBuiltinPromises(target) ? true : !!target && (typeof target === 'object' || typeof target === 'function') && typeof target.then === 'function'
}
