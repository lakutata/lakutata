import {As} from '../func/As.js'
import {isProxy} from 'node:util/types'

export function CreateObjectProxy<T extends object>(target: T, handler: ProxyHandler<T>): T {
    if (isProxy(target)) return target
    if (!target) return target
    if (typeof target !== 'object') return target
    Object.keys(target!).forEach((key: string) => {
        target[key] = CreateObjectProxy(target[key], handler)
    })
    return new Proxy(As<any>(target), handler)
}
