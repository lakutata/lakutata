import {IsPromise} from './IsPromise.js'

/**
 * Whether an object is PromiseLike object or not
 * @param target
 * @constructor
 */
export function IsPromiseLike(target: any): boolean {
    if (IsPromise(target)) return true
    const {
        then
    } = target || false
    return (then instanceof Function)
}
