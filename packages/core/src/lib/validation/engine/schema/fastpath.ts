/**
 * lakutata: the validation fast path (not from upstream). A schema made of common constructs is compiled, for given
 * validation settings, into a tree of closures which validates a value without the per node states, helpers and results
 * of the interpreter (validator.ts). It only produces successful results: on a definite error it returns INVALID, and on
 * anything it does not decide (a default computed by a function, a warning...) it returns FALLBACK; in both cases the
 * value is validated by the interpreter, which produces the result (errors included). The fast path never changes its
 * input, so falling back is always possible. INVALID lets alternatives try their next schema like the interpreter.
 *
 * The type, coercion and rule semantics are not reimplemented: the compiled nodes call the functions of the type
 * definitions with fixed helpers, whose error() returns a marker. Only the flow of a node (validator.ts validate() and
 * finalize()), the keys of objects and the items of arrays are compiled.
 */
import {clone} from '../hoek/index.js'
import type {Base} from './base.js'
import * as Common from './common.js'
import * as Errors from './errors.js'
import type {Definition, ExtendedRuleDefinition, TypeMethod} from './extend.js'
import type {Preferences, SchemaRule, ValidationHelpers, ValidationOutcome} from './model.js'
import type {State} from './state.js'
import type {PatternTerm} from './types/keys.js'
import type {Values} from './values.js'

/**
 * Returned by a compiled schema when the value must be validated by the interpreter
 */
export const FALLBACK: unique symbol = Symbol('fallback')

/**
 * Returned by a compiled schema when the value is invalid (the interpreter reports an error for it)
 */
export const INVALID: unique symbol = Symbol('invalid')

/**
 * A compiled schema: the validated value, INVALID or FALLBACK
 */
export type Compiled = (value: unknown) => unknown

/**
 * Returned by the error() of the fixed helpers
 */
const errorMarker: Readonly<{ fastPathError: true }> = Object.freeze({fastPathError: true as const})

/**
 * Thrown by the fixed helpers for what the fast path does not handle (warnings)
 */
const unsupported: unique symbol = Symbol('unsupported')

/**
 * The types compiled, with the rules compiled for each (null: all its rules)
 */
const compiledTypes: Map<string, Set<string> | null> = new Map([
    ['any', new Set<string>()],
    ['string', null],
    ['number', null],
    ['boolean', null],
    ['date', null],
    ['object', new Set(['min', 'max', 'length'])],
    ['array', new Set(['items', 'min', 'max', 'length'])],
    ['alternatives', new Set<string>()]
])

/**
 * Flags which need the interpreter
 */
const interpretedFlags: string[] = ['empty', 'cast', 'result', 'artifact', '_endedSwitch', '_hasPatternMatch', 'single', 'match']

/**
 * Terms which need the interpreter when set
 */
const interpretedTerms: string[] = ['whens', 'externals', 'renames', 'dependencies', '_exclusions', '_requireds']

/**
 * The custom rule methods known to be pure: deterministic, without side effects, calling only error() of the helpers
 */
const pureMethods: WeakSet<Function> = new WeakSet()

/**
 * Mark the method of a custom rule as pure (deterministic, without side effects, calling only error() of the helpers),
 * so the fast path can compile the schemas using it (for lakutata's own validators; other custom rules are interpreted)
 * @param method
 */
export function pure<T extends Function>(method: T): T {
    pureMethods.add(method)
    return method
}

/**
 * A key of an object schema
 */
interface KeyTerm {
    key: string
    schema: Base
}

/**
 * The fixed helpers of a compiled node: the same members as the helpers of the interpreter, error() returns a marker
 * @param schema
 * @param prefs
 */
function fixedHelpers(schema: Base, prefs: Preferences): ValidationHelpers {
    return {
        original: undefined,
        prefs,
        schema,
        state: undefined as unknown as State,
        error: (): Errors.Report => errorMarker as unknown as Errors.Report,
        errorsArray: (): Errors.ErrorItem[] => {
            const errors: Errors.ErrorItem[] = []
            ;(errors as Errors.ErrorItem[] & Record<symbol, boolean>)[Common.symbols.errors] = true
            return errors
        },
        warn: (): void => {
            throw unsupported
        },
        message: (): Errors.Report => errorMarker as unknown as Errors.Report
    }
}

/**
 * Whether an outcome has errors (validator.ts: a non array error, or a non empty array)
 * @param outcome
 */
function hasErrors(outcome: ValidationOutcome): boolean {
    return !!outcome.errors && (!Array.isArray(outcome.errors) || outcome.errors.length > 0)
}

/**
 * Whether a rule result is an error (validator.ts ruleResult())
 * @param ret
 */
function isRuleError(ret: unknown): boolean {
    return ret === errorMarker || ret instanceof Errors.Report || (Array.isArray(ret) && !!(ret as unknown[] & Record<symbol, unknown>)[Common.symbols.errors])
}

/**
 * Whether a values set can be matched without a validation state (it holds no references)
 * @param values
 */
function withoutReferences(values: Values | null): boolean {
    return !values || values._refs.size === 0
}

/**
 * Compile the checks of a rule (null: not compiled)
 * @param schema
 * @param rule
 * @param helpers
 */
function compileRule(schema: Base, rule: SchemaRule, helpers: ValidationHelpers): Compiled | null {
    const definition: ExtendedRuleDefinition<Base> = schema._definition.rules[rule.method]
    const validate: ExtendedRuleDefinition<Base>['validate'] = definition.validate
    if (!validate) return null
    const args: Record<string, unknown> = rule.args as Record<string, unknown>
    return (value: unknown): unknown => {
        const ret: unknown = validate(value, helpers, args, rule)
        return isRuleError(ret) ? INVALID : ret
    }
}

/**
 * A compiled pattern of an object schema: the key regex or the compiled key schema, and the compiled value schema
 */
interface CompiledPattern {
    regex?: RegExp
    matcher?: Compiled
    rule: Compiled
    fallthrough: boolean
}

/**
 * Compile the keys of an object schema (the validate() of the keys type and its unknown()), null: not compiled
 * @param schema
 * @param prefs
 */
function compileKeys(schema: Base, prefs: Preferences): ((value: unknown) => unknown) | null {
    const terms: Record<string, unknown> = schema.$_terms
    const keys: KeyTerm[] | null = terms.keys as KeyTerm[] | null
    const patterns: PatternTerm[] | null = terms.patterns as PatternTerm[] | null
    const type: unknown = schema.$_property('typeof')
    //Skip if there are no other rules to test (null allows any keys)
    if (!keys && !patterns) {
        return (input: unknown): unknown => (!input || typeof input !== type || Array.isArray(input)) ? INVALID : input
    }
    const children: { key: string, compiled: Compiled }[] = []
    for (const child of keys || []) {
        const compiled: Compiled | null = compileSchema(child.schema, prefs)
        if (!compiled) return null
        children.push({key: child.key, compiled})
    }
    const compiledPatterns: CompiledPattern[] = []
    //The key schemas are matched like $_match() does it (abort early, without external rules)
    const matchPrefs: Preferences = Object.assign({}, prefs, {abortEarly: true, _externals: false})
    for (const pattern of patterns || []) {
        if (pattern.matches) return null
        const rule: Compiled | null = compileSchema(pattern.rule, prefs)
        if (!rule) return null
        if (pattern.regex) {
            compiledPatterns.push({regex: pattern.regex, rule, fallthrough: !!pattern.fallthrough})
        } else {
            const matcher: Compiled | null = compileSchema(pattern.schema as Base, matchPrefs)
            if (!matcher) return null
            compiledPatterns.push({matcher, rule, fallthrough: !!pattern.fallthrough})
        }
    }
    const flags: Record<string, unknown> = schema._flags
    const stripUnknownPreference: boolean = prefs.stripUnknown ? (prefs.stripUnknown === true ? true : !!prefs.stripUnknown.objects) : false
    const handleUnknown: boolean = !!(prefs.stripUnknown && typeof flags.unknown === 'undefined' || prefs.skipFunctions)
    const forbidUnknown: boolean = !Common.defaultValue(flags.unknown, prefs.allowUnknown)
    //Without patterns, a forbidden unknown key makes the object invalid whatever its keys: it is found before them
    const childKeys: Set<string> | null = forbidUnknown && !compiledPatterns.length ? new Set(children.map((child: { key: string }): string => child.key)) : null
    return (input: unknown): unknown => {
        if (!input || typeof input !== type || Array.isArray(input)) return INVALID
        //Shallow clone value (keys.ts clone())
        const value: Record<string, unknown> = Object.create(Object.getPrototypeOf(input))
        Object.assign(value, input)
        const unprocessed: Set<string> = new Set(Object.keys(value))
        if (childKeys) {
            for (const key of unprocessed) {
                if (childKeys.has(key)) continue
                if (handleUnknown && (stripUnknownPreference || typeof value[key] === 'function')) continue
                return INVALID
            }
        }
        for (const {key, compiled} of children) {
            const item: unknown = value[key]
            unprocessed.delete(key)
            const result: unknown = compiled(item)
            if (result === FALLBACK || result === INVALID) return result
            if (result === undefined && item !== undefined) {
                delete value[key]
            } else if (result !== undefined) {
                value[key] = result
            }
        }
        //Unknown keys (keys.ts unknown())
        if (unprocessed.size) {
            for (const key of unprocessed) {
                const item: unknown = value[key]
                for (const pattern of compiledPatterns) {
                    if (pattern.regex) {
                        if (!pattern.regex.test(key)) continue
                    } else {
                        const matched: unknown = (pattern.matcher as Compiled)(key)
                        if (matched === INVALID) continue
                        if (matched === FALLBACK) return FALLBACK
                    }
                    unprocessed.delete(key)
                    const result: unknown = pattern.rule(item)
                    if (result === FALLBACK || result === INVALID) return result
                    value[key] = result
                    if (!pattern.fallthrough) break
                }
            }
            if (unprocessed.size) {
                if (handleUnknown) {
                    for (const key of unprocessed) {
                        if (stripUnknownPreference) {
                            delete value[key]
                            unprocessed.delete(key)
                        } else if (typeof value[key] === 'function') {
                            unprocessed.delete(key)
                        }
                    }
                }
                if (forbidUnknown && unprocessed.size) return INVALID
            }
        }
        return value
    }
}

/**
 * Compile the items of an array schema (the items rule of the array type, for ordered items and at most one item
 * schema, without required or forbidden item schemas), null: not compiled
 * @param schema
 * @param prefs
 */
function compileItems(schema: Base, prefs: Preferences): Compiled | null {
    const terms: Record<string, unknown[]> = schema.$_terms as Record<string, unknown[]>
    const items: Base[] = terms.items as Base[]
    const inclusions: Base[] = terms._inclusions as Base[]
    if (items.length > 1 || inclusions.length !== items.length) return null
    const inclusion: Compiled | null = inclusions.length ? compileSchema(inclusions[0], prefs) : null
    if (inclusions.length && !inclusion) return null
    const ordered: Compiled[] = []
    for (const type of terms.ordered as Base[]) {
        const compiled: Compiled | null = compileSchema(type, prefs)
        if (!compiled) return null
        ordered.push(compiled)
    }
    const sparse: boolean = !!schema._flags.sparse
    //A failing item is stripped instead (the interpreter decides)
    const stripItems: boolean = !!(prefs.stripUnknown && (prefs.stripUnknown as { arrays?: boolean }).arrays)
    return (input: unknown): unknown => {
        const value: unknown[] = input as unknown[]
        let position: number = 0
        for (let i: number = 0; i < value.length; ++i) {
            const item: unknown = value[i]
            if (!sparse && item === undefined) return INVALID
            //Ordered
            if (ordered.length) {
                if (position < ordered.length) {
                    const result: unknown = ordered[position++](item)
                    if (result === FALLBACK || result === INVALID) return result
                    if (!sparse && result === undefined) return INVALID
                    value[i] = result
                    continue
                } else if (!items.length) {
                    //More items than ordered schemas
                    return INVALID
                }
            }
            //Item schema (any item without one)
            if (inclusion) {
                const result: unknown = inclusion(item)
                if (result === FALLBACK) return FALLBACK
                if (result === INVALID) return stripItems ? FALLBACK : INVALID
                if (!sparse && result === undefined) return INVALID
                value[i] = result
            }
        }
        //Missing ordered items (errors or defaults)
        if (position < ordered.length) return FALLBACK
        return value
    }
}

/**
 * Whether a schema is made only of constructs the fast path handles (without looking at its children)
 * @param schema
 */
function compilable(schema: Base): boolean {
    if (!compiledTypes.has(schema.type)) return false
    if (schema._cache || schema._ids._schemaChain) return false
    const flags: Record<string, unknown> = schema._flags
    for (const flag of interpretedFlags) {
        if (flags[flag] !== undefined) return false
    }
    //A schema for the unknown keys
    if (typeof flags.unknown === 'object') return false
    const terms: Record<string, unknown> = schema.$_terms
    for (const term of interpretedTerms) {
        const value: unknown = terms[term]
        if (value && (!Array.isArray(value) || value.length)) return false
    }
    if (!withoutReferences(schema._valids) || !withoutReferences(schema._invalids)) return false
    const rules: Set<string> | null = compiledTypes.get(schema.type) as Set<string> | null
    for (const rule of schema._rules) {
        if (rule._resolve.length || rule.warn) return false
        if (rule.name === 'custom') {
            if (!pureMethods.has((rule.args as { method: Function }).method)) return false
            continue
        }
        if (rule.name === 'warning') return false
        if (rules && !rules.has(rule.name)) return false
    }
    return true
}

/**
 * Compile a schema for the preferences of its parent (null: not compiled)
 * @param schema
 * @param parentPrefs
 */
function compileSchema(schema: Base, parentPrefs: Preferences): Compiled | null {
    if (!compilable(schema)) return null
    const prefs: Preferences = schema._preferences ? Common.preferences(parentPrefs, schema._preferences) : parentPrefs
    if (prefs.nonEnumerables || prefs.debug) return null
    const def: Definition<Base> = schema._definition
    const flags: Record<string, unknown> = schema._flags
    const helpers: ValidationHelpers = fixedHelpers(schema, prefs)
    const prepare: TypeMethod<Base> | undefined = prefs.convert ? def.prepare : undefined
    const coerce: Definition<Base>['coerce'] | undefined = prefs.convert ? def.coerce : undefined
    const presence: unknown = flags.presence || prefs.presence
    const hasDefault: boolean = flags.default !== undefined && !prefs.noDefaults
    const deepDefault: boolean = flags.default === Common.symbols.deepDefault
    const valids: Values | null = schema._valids
    const invalids: Values | null = schema._invalids
    const insensitive: boolean | undefined = flags.insensitive as boolean | undefined
    const only: boolean = !!flags.only
    const convert: boolean = !!prefs.convert
    //Base type
    let base: ((value: unknown) => unknown) | null
    if (schema.type === 'object') {
        base = compileKeys(schema, prefs)
        if (!base) return null
    } else if (schema.type === 'alternatives') {
        base = compileAlternatives(schema, prefs)
        if (!base) return null
    } else {
        const validate: TypeMethod<Base> | undefined = def.validate
        base = validate
            ? (value: unknown): unknown => {
                const outcome: ValidationOutcome | undefined | void = validate(value, helpers)
                if (!outcome) return value
                if (hasErrors(outcome)) return INVALID
                return outcome.value
            }
            : null
    }
    //Rules
    const steps: Compiled[] = []
    for (const rule of schema._rules) {
        const definition: ExtendedRuleDefinition<Base> = def.rules[rule.method]
        //Skip rules that are also applied in coerce step
        if (definition.convert && convert) continue
        const step: Compiled | null = schema.type === 'array' && rule.name === 'items' ? compileItems(schema, prefs) : compileRule(schema, rule, helpers)
        if (!step) return null
        steps.push(step)
    }
    const source: unknown = flags.default
    //validator.ts defaultValue(): functions and references need the interpreter
    const defaulted = (): unknown => {
        if (!source) return source
        if (typeof source === 'function') return FALLBACK
        if (typeof source !== 'object') return source
        if ((source as Record<symbol, unknown>)[Common.symbols.literal]) return (source as { literal: unknown }).literal
        if (Common.isResolvable(source)) return FALLBACK
        return clone(source)
    }
    const finalize = (value: unknown): unknown => value === undefined && hasDefault ? defaulted() : value
    const node = (input: unknown): unknown => {
        let value: unknown = input
        //Prepare
        if (prepare && value !== undefined) {
            const prepared: ValidationOutcome | undefined | void = prepare(value, helpers)
            if (prepared) {
                if (prepared.errors) return INVALID
                value = prepared.value
            }
        }
        //Type coercion
        if (coerce && value !== undefined && (!coerce.from || coerce.from.includes(typeof value))) {
            const coerced: ValidationOutcome | undefined | void = coerce.method(value, helpers)
            if (coerced) {
                if (coerced.errors) return INVALID
                value = coerced.value
            }
        }
        //Presence requirements (required, optional, forbidden)
        if (value === undefined) {
            if (presence === 'forbidden') return finalize(value)
            if (presence === 'required') return INVALID
            if (presence === 'optional') return deepDefault ? FALLBACK : finalize(value)
        } else if (presence === 'forbidden') {
            return INVALID
        }
        //Allowed values
        if (valids) {
            const match: false | { value: unknown } = valids.get(value, null, prefs, insensitive)
            if (match) {
                if (convert) value = match.value
                return finalize(value)
            }
            if (only) return INVALID
        }
        //Denied values
        if (invalids && invalids.get(value, null, prefs, insensitive)) return INVALID
        //Base type
        if (base) {
            value = base(value)
            if (value === FALLBACK || value === INVALID) return value
        }
        //Rules
        for (const step of steps) {
            value = step(value)
            if (value === FALLBACK || value === INVALID) return value
        }
        return finalize(value)
    }
    //A failover value replaces the errors (the interpreter computes it)
    if (flags.failover === undefined) return node
    return (input: unknown): unknown => {
        const value: unknown = node(input)
        return value === INVALID ? FALLBACK : value
    }
}

/**
 * Compile the alternatives of an alternatives schema (tried in order, the first valid one wins), null: not compiled
 * @param schema
 * @param prefs
 */
function compileAlternatives(schema: Base, prefs: Preferences): ((value: unknown) => unknown) | null {
    const alternatives: Compiled[] = []
    for (const item of schema.$_terms.matches as { schema?: Base }[]) {
        //Conditions need the interpreter
        if (!item.schema) return null
        const compiled: Compiled | null = compileSchema(item.schema, prefs)
        if (!compiled) return null
        alternatives.push(compiled)
    }
    return (value: unknown): unknown => {
        for (const alternative of alternatives) {
            const result: unknown = alternative(value)
            //A definitely invalid alternative lets the next one be tried, an undecided one does not
            if (result !== INVALID) return result
        }
        return INVALID
    }
}

/**
 * Compiled schemas, by schema then by settings (null: the schema is not compiled for these settings)
 */
const compiledSchemas: WeakMap<Base, WeakMap<Preferences, Compiled | null>> = new WeakMap()

/**
 * The compiled schema for the validation settings (null: validate with the interpreter)
 * @param schema
 * @param settings the settings of a validation (defaults merged with the validate() options), which must not change
 */
export function compiledFor(schema: Base, settings: Preferences): Compiled | null {
    let bySettings: WeakMap<Preferences, Compiled | null> | undefined = compiledSchemas.get(schema)
    if (!bySettings) {
        bySettings = new WeakMap()
        compiledSchemas.set(schema, bySettings)
    }
    let compiled: Compiled | null | undefined = bySettings.get(settings)
    if (compiled === undefined) {
        const tree: Compiled | null = settings.debug ? null : compileSchema(schema, settings)
        compiled = tree ? guarded(tree) : null
        bySettings.set(settings, compiled)
    }
    return compiled
}

/**
 * A compiled schema which falls back on any exception (the interpreter then throws it, if it is a genuine one)
 * @param tree
 */
function guarded(tree: Compiled): Compiled {
    return (value: unknown): unknown => {
        try {
            return tree(value)
        } catch {
            return FALLBACK
        }
    }
}

/**
 * The time of a date (undefined for anything else, objects with the Date prototype included)
 * @param value
 */
function dateTime(value: object): number | undefined {
    try {
        return Date.prototype.getTime.call(value)
    } catch {
        return undefined
    }
}

/**
 * Whether the fast path and the interpreter produced the same value: same primitives (Object.is), and objects with the
 * same prototype, own keys (in order), property attributes and values, where the input is reused in the same places
 * @param fast
 * @param interpreted
 * @param input the validated value at the same place
 * @param seen
 */
export function sameResult(fast: unknown, interpreted: unknown, input: unknown, seen: Map<object, object> = new Map()): boolean {
    if (Object.is(fast, interpreted)) return true
    if (typeof fast !== 'object' || fast === null || typeof interpreted !== 'object' || interpreted === null) return false
    //Different objects: none of them may be the input (the other one would reuse it)
    if (fast === input || interpreted === input) return false
    const known: object | undefined = seen.get(fast)
    if (known) return known === interpreted
    seen.set(fast, interpreted)
    if (Object.getPrototypeOf(fast) !== Object.getPrototypeOf(interpreted)) return false
    if (Array.isArray(fast) !== Array.isArray(interpreted)) return false
    const fastTime: number | undefined = dateTime(fast)
    const time: number | undefined = dateTime(interpreted)
    if (fastTime !== undefined || time !== undefined) return fastTime !== undefined && time !== undefined && Object.is(fastTime, time)
    const fastKeys: (string | symbol)[] = Reflect.ownKeys(fast)
    const keys: (string | symbol)[] = Reflect.ownKeys(interpreted)
    if (fastKeys.length !== keys.length) return false
    for (let i: number = 0; i < keys.length; ++i) {
        const key: string | symbol = keys[i]
        if (fastKeys[i] !== key) return false
        const a: PropertyDescriptor = Object.getOwnPropertyDescriptor(fast, key) as PropertyDescriptor
        const b: PropertyDescriptor = Object.getOwnPropertyDescriptor(interpreted, key) as PropertyDescriptor
        if (a.enumerable !== b.enumerable || a.configurable !== b.configurable || a.writable !== b.writable) return false
        if (a.get !== b.get || a.set !== b.set) return false
        if ('value' in a) {
            const inputChild: unknown = input !== null && typeof input === 'object' ? (input as Record<string | symbol, unknown>)[key] : undefined
            if (!sameResult(a.value, b.value, inputChild, seen)) return false
        }
    }
    return true
}
