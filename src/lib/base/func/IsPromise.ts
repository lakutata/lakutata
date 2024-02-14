import {isPromise as isBuiltinPromises} from 'util/types'

/**
 * 判断一个目标对象是否为Promise
 * @param target
 */
export function IsPromise(target: any): boolean {
    return isBuiltinPromises(target) ? true : !!target && (typeof target === 'object' || typeof target === 'function') && typeof target.then === 'function'
}