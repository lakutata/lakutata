/**
 * Derived from the upstream lib/merge.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from './assert.js'
import {clone} from './clone.js'
import {type Indexable, isArray, keys} from './utils.js'

export interface MergeOptions {
    /**
     * Override the target value with null or undefined source values, defaults to true
     */
    readonly nullOverride?: boolean
    /**
     * Append array source values to the target array instead of replacing them, defaults to true
     */
    readonly mergeArrays?: boolean
    /**
     * Include symbol properties, defaults to true
     */
    readonly symbols?: boolean
}

/**
 * Merge all the properties of source into target (target is modified)
 * @param target
 * @param source
 * @param options
 */
export function merge<T1 extends object, T2 extends object>(target: T1, source: T2 | null | undefined, options?: MergeOptions): T1 & T2 {
    assert(target && typeof target === 'object', 'Invalid target value: must be an object')
    assert(source === null || source === undefined || typeof source === 'object', 'Invalid source value: must be null, undefined, or an object')
    if (!source) return target as T1 & T2
    const settings: MergeOptions = {nullOverride: true, mergeArrays: true, ...options}
    if (isArray(source)) {
        assert(isArray(target), 'Cannot merge array onto an object')
        //Must not change target assignment
        if (!settings.mergeArrays) target.length = 0
        for (let i: number = 0; i < source.length; ++i) target.push(clone(source[i], {symbols: settings.symbols}))
        return target as T1 & T2
    }
    const targetRecord: Indexable = target as Indexable
    const sourceRecord: Indexable = source as Indexable
    const sourceKeys: (string | symbol)[] = keys(source, settings)
    for (let i: number = 0; i < sourceKeys.length; ++i) {
        const key: string | symbol = sourceKeys[i]
        if (key === '__proto__' || !Object.prototype.propertyIsEnumerable.call(source, key)) continue
        const value: unknown = sourceRecord[key]
        if (value && typeof value === 'object') {
            //Can occur for shallow merges
            if (targetRecord[key] === value) continue
            const targetValue: unknown = targetRecord[key]
            if (!targetValue ||
                typeof targetValue !== 'object' ||
                (isArray(targetValue) !== isArray(value)) ||
                value instanceof Date ||
                Buffer.isBuffer(value) ||
                value instanceof RegExp) {
                targetRecord[key] = clone(value, {symbols: settings.symbols})
            } else {
                merge(targetValue, value, settings)
            }
        } else {
            //Explicit to preserve empty strings
            if (value !== null && value !== undefined) {
                targetRecord[key] = value
            } else if (settings.nullOverride) {
                targetRecord[key] = value
            }
        }
    }
    return target as T1 & T2
}
