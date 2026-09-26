/**
 * Derived from @hapi/hoek 11.0.7 lib/contain.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Test support only: used by expect().to.include()
 */
import {assert, deepEqual, escapeRegex, type Indexable, isArray, keys} from '../../../lib/validation/engine/hoek/index.js'

export interface ContainOptions {
    deep?: boolean
    once?: boolean
    only?: boolean
    part?: boolean
    symbols?: boolean
}

type Compare = (a: unknown, b: unknown) => boolean

interface Match {
    allowed: number
    hits: number
}

/**
 * Test whether the reference contains the values
 * @param ref string, array or object
 * @param values
 * @param options
 */
export function contain(ref: unknown, values: unknown, options: ContainOptions = {}): boolean {
    const valueList: unknown = typeof values !== 'object' ? [values] : values
    assert(!isArray(valueList) || valueList.length, 'Values array cannot be empty')
    if (typeof ref === 'string') return containString(ref, valueList as unknown[], options)
    if (isArray(ref)) return containArray(ref, valueList, options)
    assert(typeof ref === 'object', 'Reference must be string or an object')
    return containObject(ref as object, valueList, options)
}

function containArray(ref: unknown[], values: unknown, options: ContainOptions): boolean {
    const valueList: unknown[] = isArray(values) ? values : [values]
    if (!ref.length) return false
    if (options.only && options.once && ref.length !== valueList.length) return false
    let compare: Compare | undefined
    //Map values
    const map: Map<unknown, Match> = new Map()
    for (const value of valueList) {
        if (!options.deep || !value || typeof value !== 'object') {
            const existing: Match | undefined = map.get(value)
            if (existing) {
                ++existing.allowed
            } else {
                map.set(value, {allowed: 1, hits: 0})
            }
        } else {
            compare = compare ?? createCompare(options)
            let found: boolean = false
            for (const [key, existing] of map.entries()) {
                if (compare(key, value)) {
                    ++existing.allowed
                    found = true
                    break
                }
            }
            if (!found) map.set(value, {allowed: 1, hits: 0})
        }
    }
    //Lookup values
    let hits: number = 0
    for (const item of ref) {
        let match: Match | undefined
        if (!options.deep || !item || typeof item !== 'object') {
            match = map.get(item)
        } else {
            compare = compare ?? createCompare(options)
            for (const [key, existing] of map.entries()) {
                if (compare(key, item)) {
                    match = existing
                    break
                }
            }
        }
        if (match) {
            ++match.hits
            ++hits
            if (options.once && match.hits > match.allowed) return false
        }
    }
    //Validate results
    if (options.only && hits !== ref.length) return false
    for (const match of map.values()) {
        if (match.hits === match.allowed) continue
        if (match.hits < match.allowed && !options.part) return false
    }
    return !!hits
}

function containObject(ref: object, values: unknown, options: ContainOptions): boolean {
    assert(options.once === undefined, 'Cannot use option once with object')
    const refKeys: (string | symbol)[] = keys(ref, options)
    if (!refKeys.length) return false
    //Keys list
    if (isArray(values)) return containArray(refKeys, values, options)
    //Key value pairs
    const valueRecord: Indexable = values as Indexable
    const symbols: symbol[] = Object.getOwnPropertySymbols(values).filter((sym: symbol): boolean => Object.prototype.propertyIsEnumerable.call(values, sym))
    const targets: (string | symbol)[] = [...Object.keys(values as object), ...symbols]
    const compare: Compare = createCompare(options)
    const set: Set<string | symbol> = new Set(targets)
    for (const key of refKeys) {
        if (!set.has(key)) {
            if (options.only) return false
            continue
        }
        if (!compare(valueRecord[key], (ref as Indexable)[key])) return false
        set.delete(key)
    }
    if (set.size) return options.part ? set.size < targets.length : false
    return true
}

function containString(ref: string, values: unknown[], options: ContainOptions): boolean {
    //Empty string
    if (ref === '') {
        //'' contains '', and multiple '' if !once
        return values.length === 1 && values[0] === '' || !options.once && !values.some((v: unknown): boolean => v !== '')
    }
    //Map values
    const map: Map<string, Match> = new Map()
    const patterns: string[] = []
    for (const value of values) {
        assert(typeof value === 'string', 'Cannot compare string reference to non-string value')
        if (value) {
            const existing: Match | undefined = map.get(value)
            if (existing) {
                ++existing.allowed
            } else {
                map.set(value, {allowed: 1, hits: 0})
                patterns.push(escapeRegex(value))
            }
        } else if (options.once || options.only) {
            return false
        }
    }
    //Non-empty string contains unlimited empty string
    if (!patterns.length) return true
    //Match patterns
    const regex: RegExp = new RegExp(`(${patterns.join('|')})`, 'g')
    const leftovers: string = ref.replace(regex, ($0: string, $1: string): string => {
        ++(map.get($1) as Match).hits
        //Remove from string
        return ''
    })
    //Validate results
    if (options.only && leftovers) return false
    let anyHit: boolean = false
    for (const match of map.values()) {
        if (match.hits) anyHit = true
        if (match.hits === match.allowed) continue
        if (match.hits < match.allowed && !options.part) return false
        //match.hits > match.allowed
        if (options.once) return false
    }
    return anyHit
}

function createCompare(options: ContainOptions): Compare {
    if (!options.deep) return (a: unknown, b: unknown): boolean => a === b
    const hasOnly: boolean = options.only !== undefined
    const hasPart: boolean = options.part !== undefined
    const flags: { prototype: boolean, part: boolean } = {
        prototype: hasOnly ? !!options.only : hasPart ? !options.part : false,
        part: hasOnly ? !options.only : hasPart ? !!options.part : false
    }
    return (a: unknown, b: unknown): boolean => deepEqual(a, b, flags)
}
