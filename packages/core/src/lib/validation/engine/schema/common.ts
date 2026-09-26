/**
 * Derived from joi 18.0.2 lib/common.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert as Assert, AssertError, isArray} from '../hoek/index.js'
import {Lazy, type LazyMessages, type LazySchemas} from './lazy.js'
import type {PathError, Preferences, SchemaLike} from './model.js'

let Messages: LazyMessages | undefined
let Schemas: LazySchemas | undefined

const isoDate: RegExp = /^(?:[-+]\d{2})?(?:\d{4}(?!\d{2}\b))(?:(-?)(?:(?:0[1-9]|1[0-2])(?:\1(?:[12]\d|0[1-9]|3[01]))?|W(?:[0-4]\d|5[0-2])(?:-?[1-7])?|(?:00[1-9]|0[1-9]\d|[12]\d{2}|3(?:[0-5]\d|6[1-6])))(?![T]$|[T][\d]+Z$)(?:[T\s](?:(?:(?:[01]\d|2[0-3])(?:(:?)[0-5]\d)?|24\:?00)(?:[.,]\d+(?!:))?)(?:\2[0-5]\d(?:[.,]\d+)?)?(?:[Z]|(?:[+-])(?:[01]\d|2[0-3])(?::?[0-5]\d)?)?)?)?$/

/**
 * Version of the validation engine (the joi release it derives from)
 */
export const version: string = '18.0.2'

export const defaults: Preferences = {
    abortEarly: true,
    allowUnknown: false,
    artifacts: false,
    cache: true,
    context: null,
    convert: true,
    dateFormat: 'iso',
    errors: {
        escapeHtml: false,
        label: 'path',
        language: null,
        render: true,
        stack: false,
        wrap: {
            label: '"',
            array: '[]'
        }
    },
    externals: true,
    messages: {},
    nonEnumerables: false,
    noDefaults: false,
    presence: 'optional',
    skipFunctions: false,
    stripUnknown: false,
    warnings: false
}

export const symbols = {
    //Used to internally identify any-based types (shared with other engine versions)
    any: Symbol.for('@hapi/joi/schema'),
    arraySingle: Symbol('arraySingle'),
    deepDefault: Symbol('deepDefault'),
    errors: Symbol('errors'),
    literal: Symbol('literal'),
    override: Symbol('override'),
    parent: Symbol('parent'),
    prefs: Symbol('prefs'),
    ref: Symbol('ref'),
    template: Symbol('template'),
    values: Symbol('values')
} as const

export type CompareOperator = '=' | '>' | '<' | '>=' | '<='

/**
 * Read a symbol keyed property of any value
 * @param value
 * @param symbol
 */
function symbolOf(value: unknown, symbol: symbol): unknown {
    return (value as Record<symbol, unknown>)[symbol]
}

//Like upstream, keys may be a single key (then matched as a substring)
export function assertOptions(options: unknown, keys: string | string[], name: string = 'Options'): void {
    Assert(options && typeof options === 'object' && !isArray(options), 'Options must be of type object')
    const unknownKeys: string[] = Object.keys(options).filter((k: string): boolean => !keys.includes(k))
    Assert(unknownKeys.length === 0, `${name} contain unknown keys: ${unknownKeys}`)
}

export function checkPreferences(prefs: unknown): void {
    Schemas = Schemas || (Lazy.schemas as () => LazySchemas)()
    const result = Schemas.preferences.validate(prefs)
    //The preferences schema has no error override: its errors are validation errors
    if (result.error) throw new AssertError(String([(result.error as { message: string, details: { message: string }[] }).details[0].message]))
}

/**
 * Compare two values with an operator (values of any type are compared like JavaScript does)
 * @param a
 * @param b
 * @param operator
 */
export function compare(a: unknown, b: unknown, operator: CompareOperator): boolean | undefined {
    const left: number = a as number
    const right: number = b as number
    switch (operator) {
        case '=':
            return a === b
        case '>':
            return left > right
        case '<':
            return left < right
        case '>=':
            return left >= right
        case '<=':
            return left <= right
    }
}

/**
 * The value, or the default value when the value is undefined (upstream: Common.default())
 * @param value
 * @param defaultValue
 */
export function defaultValue<T, D>(value: T | undefined, defaultValue: D): T | D {
    return value === undefined ? defaultValue : value
}

export function isIsoDate(date: string): boolean {
    return isoDate.test(date)
}

export function isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value)
}

/**
 * Whether the value is a reference or a template
 * @param obj
 */
export function isResolvable(obj: unknown): boolean {
    if (!obj) return false
    return !!(symbolOf(obj, symbols.ref) || symbolOf(obj, symbols.template))
}

/**
 * Whether the value is a schema (of this engine version, or of any engine version with the legacy option)
 * @param schema
 * @param options
 */
export function isSchema(schema: unknown, options: { legacy?: boolean } = {}): schema is SchemaLike {
    const any: { version?: string } | undefined = schema ? symbolOf(schema, symbols.any) as { version?: string } | undefined : undefined
    if (!any) return false
    Assert(options.legacy || any.version === version, 'Cannot mix different versions of validation schemas')
    return true
}

export function isValues(obj: unknown): boolean {
    return !!symbolOf(obj, symbols.values)
}

export function limit(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0
}

type PreferencesRecord = Preferences & Record<symbol, unknown>

/**
 * Merge preferences
 * @param target
 * @param source
 */
export function preferences(target: Preferences | null | undefined, source: Preferences | null | undefined): Preferences {
    Messages = Messages || Lazy.messages
    const targetPrefs: Preferences = target || {}
    const sourcePrefs: Preferences = source || {}
    const merged: PreferencesRecord = Object.assign({} as PreferencesRecord, targetPrefs, sourcePrefs)
    if (sourcePrefs.errors && targetPrefs.errors) {
        merged.errors = Object.assign({}, targetPrefs.errors, sourcePrefs.errors)
        merged.errors.wrap = Object.assign({}, targetPrefs.errors.wrap, sourcePrefs.errors.wrap)
    }
    if (sourcePrefs.messages) merged.messages = (Messages as LazyMessages).compile(sourcePrefs.messages, targetPrefs.messages)
    delete merged[symbols.prefs]
    return merged
}

/**
 * Call fn, prefixing the path of a thrown error with the key
 * @param fn
 * @param key
 * @param options
 */
export function tryWithPath<T>(fn: () => T, key: string | number, options: { append?: boolean } = {}): T {
    try {
        return fn()
    } catch (err) {
        const error: PathError = err as PathError
        if (error.path !== undefined) {
            error.path = key + '.' + error.path
        } else {
            error.path = String(key)
        }
        if (options.append) error.message = `${error.message} (${error.path})`
        throw err
    }
}

/**
 * Validate a method argument, returning the error message of an invalid value
 * @param value
 * @param label
 * @param validation a schema, or a predicate with its error message
 */
export function validateArg(value: unknown, label: string | undefined, {assert, message}: { assert: SchemaLike | ((value: unknown) => unknown), message?: string }): string | undefined {
    if (isSchema(assert)) {
        const result = assert.validate(value)
        if (!result.error) return
        return result.error.message
    } else if (!(assert as (value: unknown) => unknown)(value)) {
        return label ? `${label} ${message}` : message
    }
}

export function verifyFlat(args: unknown[], method: string): void {
    for (const arg of args) Assert(!isArray(arg), 'Method no longer accepts array arguments:', method)
}
