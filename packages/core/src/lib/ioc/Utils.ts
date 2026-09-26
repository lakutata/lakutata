import {Constructor} from './Resolvers.js'
import {IsSymbol} from '../helpers/IsSymbol.js'
import {As} from '../helpers/As.js'

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
    //Arrow, async and method functions have no prototype, so they are never constructors
    const prototypeDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(fn, 'prototype')
    if (!prototypeDescriptor) return false
    //The prototype of a class (and of built-in constructors) is read-only, unlike the one of a plain function
    if (!prototypeDescriptor.writable) return true
    //A plain function named in PascalCase is treated as an ES5 constructor function
    return !!fn.name && fn.name[0] === fn.name[0].toUpperCase()
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
