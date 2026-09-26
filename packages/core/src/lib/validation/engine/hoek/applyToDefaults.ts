/**
 * Derived from @hapi/hoek 11.0.7 lib/applyToDefaults.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from './assert.js'
import {clone, type CloneSeen} from './clone.js'
import {merge} from './merge.js'
import {reach} from './reach.js'
import {type Indexable, isArray} from './utils.js'

export interface ApplyToDefaultsOptions {
    /**
     * Override the default value with null source values, defaults to false
     */
    readonly nullOverride?: boolean
    /**
     * Keys (paths) whose values are copied by reference
     */
    readonly shallow?: string[] | string[][]
}

/**
 * Apply source to a copy of the defaults
 * @param defaults
 * @param source true to return a copy of the defaults, a falsy value to return null
 * @param options
 */
export function applyToDefaults<T extends object>(defaults: T, source: Partial<T> | object | boolean | null | undefined, options: ApplyToDefaultsOptions = {}): T | null {
    assert(defaults && typeof defaults === 'object', 'Invalid defaults value: must be an object')
    assert(!source || source === true || typeof source === 'object', 'Invalid source value: must be true, falsy or an object')
    assert(typeof options === 'object', 'Invalid options: must be an object')
    //If no source, return null
    if (!source) return null
    if (options.shallow) return applyToDefaultsWithShallow(defaults, source, options)
    const copy: T = clone(defaults)
    //If source is set to true, use defaults
    if (source === true) return copy
    const nullOverride: boolean = options.nullOverride !== undefined ? options.nullOverride : false
    return merge(copy, source as object, {nullOverride, mergeArrays: false})
}

/**
 * Apply source to defaults, copying the values at the shallow paths by reference
 * @param defaults
 * @param source
 * @param options
 */
function applyToDefaultsWithShallow<T extends object>(defaults: T, source: object | true, options: ApplyToDefaultsOptions): T {
    const shallowKeys: string[] | string[][] | undefined = options.shallow
    assert(isArray(shallowKeys), 'Invalid keys')
    const seen: CloneSeen = new Map()
    const mergePaths: Set<string[]> | null = source === true ? null : new Set()
    for (const shallowKey of shallowKeys) {
        //Pre-split optimization
        const key: string[] = isArray(shallowKey) ? shallowKey : shallowKey.split('.')
        const ref: unknown = reach(defaults, key)
        if (ref && typeof ref === 'object') {
            seen.set(ref, mergePaths && reach(source, key) || ref)
        } else if (mergePaths) {
            mergePaths.add(key)
        }
    }
    const copy: T = clone(defaults, {}, seen)
    if (!mergePaths) return copy
    for (const key of mergePaths) reachCopy(copy, source as Indexable, key)
    const nullOverride: boolean = options.nullOverride !== undefined ? options.nullOverride : false
    return merge(copy, source as object, {nullOverride, mergeArrays: false})
}

/**
 * Copy the value at path from src into dst
 * @param dst
 * @param src
 * @param path
 */
function reachCopy(dst: object, src: Indexable, path: string[]): void {
    let current: Indexable = src
    for (const segment of path) {
        if (!(segment in current)) return
        const val: unknown = current[segment]
        if (typeof val !== 'object' || val === null) return
        current = val as Indexable
    }
    const value: Indexable = current
    let ref: Indexable = dst as Indexable
    for (let i: number = 0; i < path.length - 1; ++i) {
        const segment: string = path[i]
        if (typeof ref[segment] !== 'object') ref[segment] = {}
        ref = ref[segment] as Indexable
    }
    ref[path[path.length - 1]] = value
}
