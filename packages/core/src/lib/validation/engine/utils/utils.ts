/**
 * Derived from the upstream lib/utils.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * An object whose properties are accessed by key
 */
export type Indexable = Record<PropertyKey, unknown>

export interface KeysOptions {
    /**
     * Include symbol keys, defaults to true
     */
    readonly symbols?: boolean
}

/**
 * Get the own keys of an object
 * @param obj
 * @param options
 */
export function keys(obj: object, options: KeysOptions = {}): (string | symbol)[] {
    return options.symbols !== false ? Reflect.ownKeys(obj) : Object.getOwnPropertyNames(obj)
}

/**
 * Array.isArray() narrowing to unknown[] (the built-in narrows to any[])
 * @param value
 */
export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value)
}
