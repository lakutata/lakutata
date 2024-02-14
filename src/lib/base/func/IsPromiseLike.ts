import {IsPromise} from './IsPromise.js'

/**
 * 判断一个目标对象是否为PromiseLike
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