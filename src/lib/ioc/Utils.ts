import {createTokenizer, Token} from './FunctionTokenizer.js'
import {Constructor} from './Resolvers.js'

/**
 * 一个快速的展开工具，用于展开一个二维数组
 * @param array
 */
export function flatten<T>(array: Array<Array<T>>): Array<T> {
    const result: Array<T> = []
    array.forEach((arr) => {
        arr.forEach((item) => {
            result.push(item)
        })
    })
    return result
}

/**
 * 如果输入的格式不是{name: value}，则创建一个{name: value}对象
 * @param name
 * @param value
 */
export function nameValueToObject(
    name: string | symbol | object,
    value?: any
): Record<string | symbol, any> {
    let obj: string | symbol | object = name
    if (typeof obj === 'string' || typeof obj === 'symbol') return {[name as any]: value}
    return obj
}

/**
 * 返回数组中的最后一个元素
 * @param arr
 */
export function last<T>(arr: Array<T>): T {
    return arr[arr.length - 1]
}

/**
 * 确定给定的函数是否是一个类
 * @param fn
 */
export function isClass(fn: Function | Constructor<any>): boolean {
    /*tslint:disable-next-line*/
    if (typeof fn !== 'function') {
        return false
    }
    // Should only need 2 tokens.
    const tokenizer = createTokenizer(fn.toString())
    const first = tokenizer.next()
    if (first.type === 'class') return true
    const second: Token = tokenizer.next()
    if (first.type === 'function' && second.value) {
        if (second.value[0] === second.value[0].toUpperCase()) return true
    }
    return false
}

/**
 * 确定给定的值是否是一个函数
 * @param val
 */
export function isFunction(val: any): boolean {
    return typeof val === 'function'
}

/**
 * 数组去重
 * @param arr
 */
export function uniq<T>(arr: Array<T>): Array<T> {
    return Array.from(new Set(arr))
}
