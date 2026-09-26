/**
 * Internal types shared by the modules of the validation engine (derived from joi 18.0.2, BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import type {Base} from './base.js'
import type {ErrorItem, Report, ReportLocal} from './errors.js'
import type {MessagesInput} from './messages.js'
import type {State} from './state.js'
import type {Tracer} from './trace.js'

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
    //Internal: disables the external rules (when matching)
    _externals?: boolean
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
    error?: { message: string } | null
    value?: unknown
}

/**
 * A schema, as far as the modules which cannot depend on the schema class use it
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
        label?: unknown
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

/**
 * Schema flags (set by the schema methods and by the type definitions)
 */
export interface SchemaFlags {
    id?: string
    label?: string
    [name: string]: unknown
}

/**
 * A rule applied by a schema (the options of $_addRule(), normalized)
 */
export interface SchemaRule {
    name: string
    method: string
    args?: Record<string, unknown> | null
    //Names of the arguments which are references, resolved at validation time
    _resolve: string[]
    [option: string]: unknown
}

/**
 * The options of $_addRule() (a rule before normalization)
 */
export interface SchemaRuleOptions {
    name: string
    method?: string
    args?: Record<string, unknown> | null
    [option: string]: unknown
}

/**
 * Runtime state of a schema (not cloned)
 */
export interface SchemaTemp {
    //null: use last, false: error, number: start position
    ruleset: number | false | null
    //Runtime cache of generated whens
    whens: Record<string, SchemaInternals>
}

/**
 * A validation results cache (see schema.cache())
 */
export interface CacheLike {
    get(value: unknown): unknown
    set(value: unknown, result: unknown): void
}

/**
 * The schema internals used by the engine modules: the schema class
 */
export type SchemaInternals = Base

/**
 * The root object (Engine), as far as the engine modules use it
 */
export interface RootLike {
    override: symbol
    _tracer?: Tracer | null
    trace?(): Tracer
    untrace?(): void
    alternatives(): { try(...schemas: unknown[]): SchemaInternals }
    assert(value: unknown, schema: unknown, ...args: unknown[]): unknown
    custom(method: Function): SchemaInternals
    date(): SchemaInternals
    invalid(...values: unknown[]): SchemaInternals
    object(): { keys(schema?: unknown): SchemaInternals }
    string(): { regex(pattern: RegExp): SchemaInternals }
    valid(...values: unknown[]): SchemaInternals
}

/**
 * The helpers passed to the type and rule methods of a validation
 */
export interface ValidationHelpers<S extends SchemaInternals = SchemaInternals> {
    original: unknown
    prefs: Preferences
    schema: S
    state: State
    error(code: string, local?: ReportLocal | null, localState?: State): Report
    errorsArray(): ErrorItem[]
    warn(code: string, local?: ReportLocal | null, localState?: State): void
    message(messages: MessagesInput, local?: ReportLocal | null): Report
}

/**
 * The outcome of a type or rule method: a (new) value and/or errors, or nothing when the value is kept as is
 */
export interface ValidationOutcome {
    value?: unknown
    errors?: ErrorItem | ErrorItem[] | null
}
