/**
 * Derived from joi 18.0.2 lib/values.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, deepEqual, isArray} from '../hoek/index.js'
import * as Common from './common.js'
import type {Preferences, StateLike} from './model.js'
import type {Manager} from './ref.js'

/**
 * A resolvable value (reference or template) of a values set
 */
export interface ResolvableValue {
    in?: boolean
    resolve(value: unknown, state: StateLike, prefs: Preferences, local: unknown, options?: { in?: boolean }): unknown
    describe(): unknown
}

/**
 * A match of a values set: the matched value, and the reference it came from
 */
export interface ValuesMatch {
    value: unknown
    ref?: ResolvableValue
}

export type ValuesDescription = ({ override: true } | { value: unknown } | unknown)[]

function lowercases(from: Iterable<unknown> | undefined): Map<string, string> {
    const map: Map<string, string> = new Map()
    if (from) {
        for (const value of from) {
            if (typeof value === 'string') map.set(value.toLowerCase(), value)
        }
    }
    return map
}

/**
 * A set of allowed (valid) or forbidden (invalid) values and references
 */
export class Values {

    //Read by the tracer
    public _values: Set<unknown>

    //Read by the tracer
    public _refs: Set<ResolvableValue>

    protected _lowercase: Map<string, string>

    protected _override: boolean

    constructor(values?: Iterable<unknown>, refs?: Iterable<ResolvableValue>) {
        this._values = new Set(values)
        this._refs = new Set(refs)
        this._lowercase = lowercases(values)
        this._override = false
    }

    public get length(): number {
        return this._values.size + this._refs.size
    }

    public add(value: unknown, refs?: Manager): void {
        //Reference
        if (Common.isResolvable(value)) {
            if (!this._refs.has(value as ResolvableValue)) {
                this._refs.add(value as ResolvableValue)
                //Skipped in a merge
                if (refs) refs.register(value)
            }
            return
        }
        //Value
        if (!this.has(value, null, null, false)) {
            this._values.add(value)
            if (typeof value === 'string') this._lowercase.set(value.toLowerCase(), value)
        }
    }

    public static merge(target: Values | null | undefined, source: Values | null | undefined, remove?: Values | null): Values | null {
        const merged: Values = target || new Values()
        if (source) {
            if (source._override) return source.clone()
            for (const item of [...source._values, ...source._refs]) merged.add(item)
        }
        if (remove) {
            for (const item of [...remove._values, ...remove._refs]) merged.remove(item)
        }
        return merged.length ? merged : null
    }

    public remove(value: unknown): void {
        //Reference
        if (Common.isResolvable(value)) {
            this._refs.delete(value as ResolvableValue)
            return
        }
        //Value
        this._values.delete(value)
        if (typeof value === 'string') this._lowercase.delete(value.toLowerCase())
    }

    public has(value: unknown, state: StateLike | null, prefs: Preferences | null, insensitive?: boolean): boolean {
        return !!this.get(value, state, prefs, insensitive)
    }

    public get(value: unknown, state: StateLike | null, prefs: Preferences | null, insensitive?: boolean): ValuesMatch | false {
        if (!this.length) return false
        //Simple match
        if (this._values.has(value)) return {value}
        //Case insensitive string match
        if (typeof value === 'string' && value && insensitive) {
            const found: string | undefined = this._lowercase.get(value.toLowerCase())
            if (found) return {value: found}
        }
        if (!this._refs.size && typeof value !== 'object') return false
        //Objects
        if (typeof value === 'object') {
            for (const item of this._values) {
                if (deepEqual(item, value)) return {value: item}
            }
        }
        //References
        if (state) {
            for (const ref of this._refs) {
                const resolved: unknown = ref.resolve(value, state, prefs as Preferences, null, {in: true})
                if (resolved === undefined) continue
                const items: unknown[] = !ref.in || typeof resolved !== 'object'
                    ? [resolved]
                    : isArray(resolved) ? resolved : Object.keys(resolved as object)
                for (const item of items) {
                    if (typeof item !== typeof value) continue
                    if (insensitive && value && typeof value === 'string') {
                        if ((item as string).toLowerCase() === value.toLowerCase()) return {value: item, ref}
                    } else {
                        if (deepEqual(item, value)) return {value: item, ref}
                    }
                }
            }
        }
        return false
    }

    public override(): void {
        this._override = true
    }

    public values(options?: { display?: boolean }): unknown[] {
        if (options && options.display) {
            const values: unknown[] = []
            for (const item of [...this._values, ...this._refs]) {
                if (item !== undefined) values.push(item)
            }
            return values
        }
        return Array.from([...this._values, ...this._refs])
    }

    public clone(): Values {
        const set: Values = new Values(this._values, this._refs)
        set._override = this._override
        return set
    }

    /**
     * Alias of clone()
     */
    public slice(): Values {
        return this.clone()
    }

    public concat(source: Values): Values {
        assert(!source._override, 'Cannot concat override set of values')
        const set: Values = new Values([...this._values, ...source._values], [...this._refs, ...source._refs])
        set._override = this._override
        return set
    }

    public describe(): ValuesDescription {
        const normalized: ValuesDescription = []
        if (this._override) normalized.push({override: true})
        for (const value of this._values.values()) normalized.push(value && typeof value === 'object' ? {value} : value)
        for (const value of this._refs.values()) normalized.push(value.describe())
        return normalized
    }
}

Object.defineProperty(Values.prototype, Common.symbols.values, {value: true, writable: true, enumerable: true, configurable: true})

