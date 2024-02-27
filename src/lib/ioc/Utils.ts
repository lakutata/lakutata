import {createTokenizer, Token} from './FunctionTokenizer.js'
import {Constructor} from './Resolvers.js'
import {IsSymbol} from '../base/func/IsSymbol.js'
import {As} from '../base/func/As.js'

/**
 * Quick flatten utility to flatten a 2-dimensional array.
 * @param array
 */
export function flatten<T>(array: Array<Array<T>>): Array<T> {
    const result: Array<T> = []
    array.forEach((arr: T[]): void => {
        arr.forEach((item: T): void => {
            result.push(item)
        })
    })
    return result
}

/**
 * Creates a { name: value } object if the input isn't already in that format.
 * @param name
 * @param value
 */
export function nameValueToObject(
    name: string | symbol | object,
    value?: any
): Record<string | symbol, any> {
    const obj: string | symbol | object = name
    if (typeof obj === 'string' || IsSymbol(obj)) return {[name as any]: value}
    return As(obj)
}

/**
 * Returns the last item in the array.
 * @param arr
 */
export function last<T>(arr: Array<T>): T {
    return arr[arr.length - 1]
}

/**
 * Determines if the given function is a class.
 * @param fn
 */
export function isClass(fn: Function | Constructor<any>): boolean {
    if (typeof fn !== 'function') return false
    // Should only need 2 tokens.
    const tokenizer = createTokenizer(fn.toString())
    const first: Token = tokenizer.next()
    if (first.type === 'class') return true
    const second: Token = tokenizer.next()
    if (first.type === 'function' && second.value) {
        if (second.value[0] === second.value[0].toUpperCase()) {
            return true
        }
    }
    return false
}

/**
 * Determines if the given value is a function.
 * @param val
 */
export function isFunction(val: unknown): boolean {
    return typeof val === 'function'
}

/**
 * Returns the unique items in the array.
 * The array to remove dupes from.
 * @param arr
 */
export function uniq<T>(arr: Array<T>): Array<T> {
    return Array.from(new Set(arr))
}
