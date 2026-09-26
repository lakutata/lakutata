/**
 * Internal types shared by the modules of the joi engine (derived from joi 18.0.2, BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * How errors are rendered
 */
export interface ErrorPreferences {
    escapeHtml?: boolean
    label?: 'path' | 'key' | false
    language?: string | null | object
    render?: boolean
    stack?: boolean
    wrap?: {
        label?: string | false
        array?: string | false
        string?: string | false
    }
}

/**
 * Validation preferences (the validate() options)
 */
export interface Preferences {
    abortEarly?: boolean
    allowUnknown?: boolean
    artifacts?: boolean
    cache?: boolean
    context?: unknown
    convert?: boolean
    dateFormat?: 'date' | 'iso' | 'string' | 'time' | 'utc'
    debug?: boolean
    errors?: ErrorPreferences
    externals?: boolean
    messages?: unknown
    nonEnumerables?: boolean
    noDefaults?: boolean
    presence?: 'optional' | 'required' | 'forbidden'
    skipFunctions?: boolean
    stripUnknown?: boolean | { arrays?: boolean, objects?: boolean }
    warnings?: boolean
}

/**
 * An error which may carry the path of the (nested) key it was raised for
 */
export interface PathError {
    message: string
    path?: string
}

/**
 * The result of a schema validation, as far as the engine modules read it
 */
export interface ValidationResultLike {
    error?: { message: string, details: { message: string }[] }
    value?: unknown
}

/**
 * A validated schema, as far as the engine modules use it before base.ts types the schema class
 */
export interface SchemaLike {
    validate(value: unknown, preferences?: Preferences): ValidationResultLike
}

/**
 * A key of an object path
 */
export type PathKey = string | number

/**
 * Details of one validation error
 */
export interface ErrorDetail {
    message: string
    path: PathKey[]
    type: string
    context?: {
        key?: PathKey
        label?: string
        value?: unknown
        [name: string]: unknown
    }
}

/**
 * Validation-wide state shared by all the states of one validation (the parts read outside validator.ts)
 */
export interface MainstayLike {
    shadow?: { get(path: PathKey[]): unknown } | null
    tracer: { resolve(state: StateLike, ref: unknown, resolved: unknown): void }
}

/**
 * State of the value being validated (the parts read outside state.ts)
 */
export interface StateLike {
    ancestors: unknown[]
    path: PathKey[]
    mainstay?: MainstayLike | null
}
