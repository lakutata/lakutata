/**
 * Derived from the upstream lib/validator.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone, ignore, reach} from '../utils/index.js'
import {assert, setMessage} from './assert.js'
import * as Common from './common.js'
import * as Errors from './errors.js'
import type {CastDefinition, Definition, ExtendedRuleDefinition, RuleArgDefinition} from './extend.js'
import type {MessagesInput} from './messages.js'
import type {PathKey, Preferences, SchemaInternals, SchemaRule, ValidationHelpers, ValidationOutcome} from './model.js'
import type {Shadow} from './state.js'
import {State, type StateSchemaEntry} from './state.js'
import type {DebugEvent, Store} from './trace.js'
import {compiledFor, FALLBACK, INVALID, sameResult} from './fastpath.js'
import type {ValuesMatch} from './values.js'

/**
 * The tracer parts a validation uses (a coverage store, or a no-op tracer)
 */
export type ValidationTracer = Pick<Store, 'active' | 'debug' | 'entry' | 'filter' | 'log' | 'resolve' | 'value'>

/**
 * The helpers passed to an external rule
 */
export interface ExternalHelpers {
    schema: SchemaInternals
    linked: SchemaInternals | null
    state: State
    prefs: Preferences | undefined
    original: unknown
    error(code: string, local?: Errors.ReportLocal | null): Errors.Report
    errorsArray(): Errors.ErrorItem[]
    warn(code: string, local?: Errors.ReportLocal | null): void
    message(messages: MessagesInput, local?: Errors.ReportLocal | null): Errors.Report
}

export type ExternalMethod = (value: unknown, helpers: ExternalHelpers) => unknown

/**
 * An external rule, queued to run after the validation (by validateAsync())
 */
export interface External {
    method: ExternalMethod
    schema: SchemaInternals
    state: State
    label: unknown
}

/**
 * The outcome of a (synchronous) validation
 */
export interface ValidationResult {
    value: unknown
    error?: Error
    warning?: Errors.ErrorsDetails
    debug?: DebugEvent[]
    artifacts?: Map<unknown, PathKey[][]>
}

/**
 * The value and errors of the validation of a schema
 */
export interface SchemaResult {
    value: unknown
    errors: Errors.ErrorItem[] | null
}

/**
 * The validation-time error, which may carry the debug log
 */
type DebuggedError = Error & { debug?: DebugEvent[] }

type Presence = Preferences['presence'] | null

interface Snapshot {
    externals: External[]
    warnings: Errors.ErrorItem[]
}

/**
 * Validation-wide state shared by all the states of one validation
 */
export class Mainstay {

    public externals: External[]

    public warnings: Errors.ErrorItem[]

    public tracer: ValidationTracer

    public debug: DebugEvent[] | null

    public links: Map<SchemaInternals, SchemaInternals> | null

    public shadow: Shadow | null

    public artifacts: Map<unknown, PathKey[][]> | null

    protected _snapshots: Snapshot[]

    constructor(tracer: ValidationTracer, debug: DebugEvent[] | null, links: Map<SchemaInternals, SchemaInternals> | null) {
        this.externals = []
        this.warnings = []
        this.tracer = tracer
        this.debug = debug
        this.links = links
        this.shadow = null
        this.artifacts = null
        this._snapshots = []
    }

    public snapshot(): void {
        this._snapshots.push({
            externals: this.externals.slice(),
            warnings: this.warnings.slice()
        })
    }

    public restore(): void {
        const snapshot: Snapshot = this._snapshots.pop() as Snapshot
        this.externals = snapshot.externals
        this.warnings = snapshot.warnings
    }

    public commit(): void {
        this._snapshots.pop()
    }
}

/**
 * Validate a value (synchronously)
 * @param value
 * @param schema
 * @param prefs
 */
export function entry(value: unknown, schema: SchemaInternals, prefs?: Preferences): ValidationResult {
    let settings: Preferences = Common.defaults
    if (prefs) {
        assert(prefs.warnings === undefined, 'Cannot override warnings preference in synchronous validation')
        assert(prefs.artifacts === undefined, 'Cannot override artifacts preference in synchronous validation')
        settings = entrySettings(prefs)
    }
    const fast: unknown = fastPath(value, schema, settings)
    if (fast !== FALLBACK && fast !== INVALID && fastPathMode === 'on') return {value: fast}
    const result: EntryResult = validateEntry(value, schema, settings)
    if (fastPathMode === 'verify') verifyFastPath(value, fast, result)
    assert(!result.mainstay.externals.length, 'Schema with external rules must use validateAsync()')
    const outcome: ValidationResult = {value: result.value}
    if (result.error) outcome.error = result.error
    if (result.mainstay.warnings.length) outcome.warning = Errors.details(result.mainstay.warnings)
    if (result.mainstay.debug) outcome.debug = result.mainstay.debug
    if (result.mainstay.artifacts) outcome.artifacts = result.mainstay.artifacts
    return outcome
}

/**
 * Validate a value, running the external rules; throws the validation error
 * @param value
 * @param schema
 * @param prefs
 */
export async function entryAsync(value: unknown, schema: SchemaInternals, prefs?: Preferences): Promise<unknown> {
    let settings: Preferences = Common.defaults
    if (prefs) settings = entrySettings(prefs)
    const fast: unknown = fastPath(value, schema, settings)
    if (fast !== FALLBACK && fast !== INVALID && fastPathMode === 'on') {
        if (!settings.warnings && !settings.debug && !settings.artifacts) return fast
        return {value: fast}
    }
    const result: EntryResult = validateEntry(value, schema, settings)
    if (fastPathMode === 'verify') verifyFastPath(value, fast, result)
    const mainstay: Mainstay = result.mainstay
    if (result.error) {
        if (mainstay.debug) (result.error as DebuggedError).debug = mainstay.debug
        throw result.error
    }
    if (mainstay.externals.length) {
        let root: unknown = result.value
        const errors: Errors.ErrorItem[] = []
        for (const external of mainstay.externals) {
            const path: PathKey[] = external.state.path
            const linked: SchemaInternals | null = external.schema.type === 'link' ? (mainstay.links as Map<SchemaInternals, SchemaInternals>).get(external.schema) as SchemaInternals : null
            let node: unknown = root
            let key: PathKey | undefined
            let parent: Record<PathKey, unknown> | undefined
            const ancestors: unknown[] = path.length ? [root] : []
            const original: unknown = path.length ? reach(value, path) : value
            if (path.length) {
                key = path[path.length - 1]
                let current: unknown = root
                for (const segment of path.slice(0, -1)) {
                    current = (current as Record<PathKey, unknown>)[segment]
                    ancestors.unshift(current)
                }
                parent = ancestors[0] as Record<PathKey, unknown>
                node = parent[key]
            }
            try {
                const createError = (code: string, local?: Errors.ReportLocal | null): Errors.Report => (linked || external.schema).$_createError(code, node, local, external.state, settings)
                const output: unknown = await external.method(node, {
                    schema: external.schema,
                    linked,
                    state: external.state,
                    prefs,
                    original,
                    error: createError,
                    errorsArray,
                    warn: (code: string, local?: Errors.ReportLocal | null): void => {
                        mainstay.warnings.push((linked || external.schema).$_createError(code, node, local, external.state, settings))
                    },
                    message: (messages: MessagesInput, local?: Errors.ReportLocal | null): Errors.Report => (linked || external.schema).$_createError('external', node, local, external.state, settings, {messages})
                })
                if (output === undefined || output === node) continue
                if (output instanceof Errors.Report) {
                    mainstay.tracer.log(external.schema, external.state, 'rule', 'external', 'error')
                    errors.push(output)
                    if (settings.abortEarly) break
                    continue
                }
                if (Array.isArray(output) && (output as unknown[] & Record<symbol, unknown>)[Common.symbols.errors]) {
                    mainstay.tracer.log(external.schema, external.state, 'rule', 'external', 'error')
                    errors.push(...(output as Errors.ErrorItem[]))
                    if (settings.abortEarly) break
                    continue
                }
                if (parent) {
                    mainstay.tracer.value(external.state, 'rule', node, output, 'external')
                    parent[key as PathKey] = output
                } else {
                    mainstay.tracer.value(external.state, 'rule', root, output, 'external')
                    root = output
                }
            } catch (err) {
                //Change message to include path
                if ((settings.errors as NonNullable<Preferences['errors']>).label) setMessage(err as Error, `${(err as Error).message} (${(external.label)})`)
                throw err
            }
        }
        result.value = root
        if (errors.length) {
            result.error = Errors.process(errors, value, settings) as DebuggedError
            if (mainstay.debug) (result.error as DebuggedError).debug = mainstay.debug
            throw result.error
        }
    }
    if (!settings.warnings && !settings.debug && !settings.artifacts) return result.value
    const outcome: ValidationResult = {value: result.value}
    if (mainstay.warnings.length) outcome.warning = Errors.details(mainstay.warnings)
    if (mainstay.debug) outcome.debug = mainstay.debug
    if (mainstay.artifacts) outcome.artifacts = mainstay.artifacts
    return outcome
}

/**
 * Validate a value, asynchronously when the schema is asynchronous (Standard Schema)
 * @param value
 * @param schema
 */
export function standard(value: unknown, schema: SchemaInternals): ValidationResult | Promise<unknown> {
    if (schema.isAsync()) return entryAsync(value, schema)
    return entry(value, schema)
}

interface EntryResult {
    value: unknown
    error: Error | null
    mainstay: Mainstay
}

function validateEntry(value: unknown, schema: SchemaInternals, prefs: Preferences): EntryResult {
    //Prepare state
    const {tracer, cleanup} = tracerOf(schema, prefs)
    const debug: DebugEvent[] | null = prefs.debug ? [] : null
    const links: Map<SchemaInternals, SchemaInternals> | null = schema._ids._schemaChain ? new Map() : null
    const mainstay: Mainstay = new Mainstay(tracer, debug, links)
    const schemas: StateSchemaEntry[] | null = schema._ids._schemaChain ? [{schema}] : null
    const state: State = new State([], [], {mainstay, schemas})
    //Validate value
    const result: SchemaResult = validate(value, schema, state, prefs)
    //Process value and errors
    if (cleanup) (schema.$_root.untrace as () => void)()
    const error: Error | null = Errors.process(result.errors, value, prefs)
    return {value: result.value, error, mainstay}
}

function tracerOf(schema: SchemaInternals, prefs: Preferences): { tracer: ValidationTracer, cleanup?: boolean } {
    if (schema.$_root._tracer) return {tracer: schema.$_root._tracer._register(schema)}
    if (prefs.debug) {
        assert(schema.$_root.trace, 'Debug mode not supported')
        return {tracer: schema.$_root.trace()._register(schema), cleanup: true}
    }
    return {tracer: ignoreTracer}
}

/**
 * Validate a value against a schema, in the state of a validation
 * @param value
 * @param schema
 * @param state
 * @param prefs
 * @param overrides
 */
export function validate(value: unknown, schema: SchemaInternals, state: State, prefs: Preferences, overrides: { presence?: Presence } = {}): SchemaResult {
    if (schema.$_terms.whens) schema = schema._generate(value, state, prefs).schema
    //Setup state and settings
    if (schema._preferences) prefs = prefsOf(schema, prefs)
    //Cache
    if (schema._cache && prefs.cache) {
        const result: SchemaResult | undefined = schema._cache.get(value) as SchemaResult | undefined
        state.mainstay.tracer.debug(state, 'validate', 'cached', !!result)
        if (result) return result
    }
    //Helpers
    const createError = (code: string, local?: Errors.ReportLocal | null, localState?: State): Errors.Report => schema.$_createError(code, value, local, localState || state, prefs)
    const helpers: ValidationHelpers = {
        original: value,
        prefs,
        schema,
        state,
        error: createError,
        errorsArray,
        warn: (code: string, local?: Errors.ReportLocal | null, localState?: State): void => {
            state.mainstay.warnings.push(createError(code, local, localState))
        },
        message: (messages: MessagesInput, local?: Errors.ReportLocal | null): Errors.Report => schema.$_createError('custom', value, local, state, prefs, {messages})
    }
    //Prepare
    state.mainstay.tracer.entry(schema, state)
    const def: Definition = schema._definition
    if (def.prepare && value !== undefined && prefs.convert) {
        const prepared: ValidationOutcome | undefined | void = def.prepare(value, helpers)
        if (prepared) {
            state.mainstay.tracer.value(state, 'prepare', value, prepared.value)
            //Prepare error always aborts early
            if (prepared.errors) return finalize(prepared.value, ([] as Errors.ErrorItem[]).concat(prepared.errors), helpers)
            value = prepared.value
        }
    }
    //Type coercion
    if (def.coerce && value !== undefined && prefs.convert && (!def.coerce.from || def.coerce.from.includes(typeof value))) {
        const coerced: ValidationOutcome | undefined | void = def.coerce.method(value, helpers)
        if (coerced) {
            state.mainstay.tracer.value(state, 'coerced', value, coerced.value)
            //Coerce error always aborts early
            if (coerced.errors) return finalize(coerced.value, ([] as Errors.ErrorItem[]).concat(coerced.errors), helpers)
            value = coerced.value
        }
    }
    //Empty value
    const empty: SchemaInternals | undefined = schema._flags.empty as SchemaInternals | undefined
    if (empty && empty.$_match(trim(value, schema), state.nest(empty), Common.defaults)) {
        state.mainstay.tracer.value(state, 'empty', value, undefined)
        value = undefined
    }
    //Presence requirements (required, optional, forbidden)
    const presence: Presence = overrides.presence || schema._flags.presence as Presence || (schema._flags._endedSwitch ? null : prefs.presence)
    if (value === undefined) {
        if (presence === 'forbidden') return finalize(value, null, helpers)
        if (presence === 'required') return finalize(value, [schema.$_createError('any.required', value, null, state, prefs)], helpers)
        if (presence === 'optional') {
            if (schema._flags.default !== Common.symbols.deepDefault) return finalize(value, null, helpers)
            state.mainstay.tracer.value(state, 'default', value, {})
            value = {}
        }
    } else if (presence === 'forbidden') {
        return finalize(value, [schema.$_createError('any.unknown', value, null, state, prefs)], helpers)
    }
    //Allowed values
    const errors: Errors.ErrorItem[] = []
    if (schema._valids) {
        const match: ValuesMatch | false = schema._valids.get(value, state, prefs, schema._flags.insensitive as boolean | undefined)
        if (match) {
            if (prefs.convert) {
                state.mainstay.tracer.value(state, 'valids', value, match.value)
                value = match.value
            }
            state.mainstay.tracer.filter(schema, state, 'valid', match)
            return finalize(value, null, helpers)
        }
        if (schema._flags.only) {
            const report: Errors.Report = schema.$_createError('any.only', value, {valids: schema._valids.values({display: true})}, state, prefs)
            if (prefs.abortEarly) return finalize(value, [report], helpers)
            errors.push(report)
        }
    }
    //Denied values
    if (schema._invalids) {
        const match: ValuesMatch | false = schema._invalids.get(value, state, prefs, schema._flags.insensitive as boolean | undefined)
        if (match) {
            state.mainstay.tracer.filter(schema, state, 'invalid', match)
            const report: Errors.Report = schema.$_createError('any.invalid', value, {invalids: schema._invalids.values({display: true})}, state, prefs)
            if (prefs.abortEarly) return finalize(value, [report], helpers)
            errors.push(report)
        }
    }
    //Base type
    if (def.validate) {
        const base: ValidationOutcome | undefined | void = def.validate(value, helpers)
        if (base) {
            state.mainstay.tracer.value(state, 'base', value, base.value)
            value = base.value
            if (base.errors) {
                if (!Array.isArray(base.errors)) {
                    errors.push(base.errors)
                    //Base error always aborts early
                    return finalize(value, errors, helpers)
                }
                if (base.errors.length) {
                    errors.push(...base.errors)
                    //Base error always aborts early
                    return finalize(value, errors, helpers)
                }
            }
        }
    }
    //Validate tests
    if (!schema._rules.length) return finalize(value, errors, helpers)
    return rules(value, errors, helpers)
}

function rules(value: unknown, errors: Errors.ErrorItem[], helpers: ValidationHelpers): SchemaResult {
    const {schema, state, prefs} = helpers
    for (const rule of schema._rules) {
        const definition: ExtendedRuleDefinition = schema._definition.rules[rule.method]
        //Skip rules that are also applied in coerce step
        if (definition.convert && prefs.convert) {
            state.mainstay.tracer.log(schema, state, 'rule', rule.name, 'full')
            continue
        }
        //Resolve references
        let ret: unknown
        let args: Record<string, unknown> = rule.args as Record<string, unknown>
        if (rule._resolve.length) {
            //Shallow copy
            args = Object.assign({}, args)
            for (const key of rule._resolve) {
                const resolver: RuleArgDefinition = (definition.argsByName as Map<string, RuleArgDefinition>).get(key) as RuleArgDefinition
                const resolved: unknown = (args[key] as Resolvable).resolve(value, state, prefs)
                const normalized: unknown = resolver.normalize ? resolver.normalize(resolved) : resolved
                //Like upstream: a reference argument is expected to have an assertion
                const invalid: string | undefined = Common.validateArg(normalized, undefined, resolver as RuleArgDefinition & Required<Pick<RuleArgDefinition, 'assert'>>)
                if (invalid) {
                    ret = schema.$_createError('any.ref', resolved, {arg: key, ref: args[key], reason: invalid}, state, prefs)
                    break
                }
                args[key] = normalized
            }
        }
        //Test rule
        //Use ret if already set to reference error
        ret = ret || (definition.validate as NonNullable<ExtendedRuleDefinition['validate']>)(value, helpers, args, rule)
        const result: RuleResult = ruleResult(ret, rule)
        if (result.errors) {
            state.mainstay.tracer.log(schema, state, 'rule', rule.name, 'error')
            if (rule.warn) {
                state.mainstay.warnings.push(...result.errors)
                continue
            }
            if (prefs.abortEarly) return finalize(value, result.errors, helpers)
            errors.push(...result.errors)
        } else {
            state.mainstay.tracer.log(schema, state, 'rule', rule.name, 'pass')
            state.mainstay.tracer.value(state, 'rule', value, result.value, rule.name)
            value = result.value
        }
    }
    return finalize(value, errors, helpers)
}

interface Resolvable {
    resolve(value: unknown, state: State, prefs: Preferences): unknown
}

interface RuleResult {
    errors: Errors.Report[] | null
    value: unknown
}

function ruleResult(ret: unknown, rule: SchemaRule): RuleResult {
    if (ret instanceof Errors.Report) {
        error(ret, rule)
        return {errors: [ret], value: null}
    }
    if (Array.isArray(ret) && (ret as unknown[] & Record<symbol, unknown>)[Common.symbols.errors]) {
        ret.forEach((report: Errors.Report): Errors.Report => error(report, rule))
        return {errors: ret, value: null}
    }
    return {errors: null, value: ret}
}

function error(report: Errors.Report, rule: SchemaRule): Errors.Report {
    if (rule.message) report._setTemplate(rule.message as Errors.Report['template'])
    return report
}

type ErrorOverride = Error | Errors.Report | ((errors: Errors.ErrorItem[]) => Errors.ErrorItem | Errors.ErrorItem[])

function finalize(value: unknown, errors: Errors.ErrorItem[] | null, helpers: ValidationHelpers): SchemaResult {
    errors = errors || []
    const {schema, state, prefs} = helpers
    //Failover value
    if (errors.length) {
        const failover: unknown = defaultValue('failover', undefined, errors, helpers)
        if (failover !== undefined) {
            state.mainstay.tracer.value(state, 'failover', value, failover)
            value = failover
            errors = []
        }
    }
    //Error override
    const override: ErrorOverride | undefined = schema._flags.error as ErrorOverride | undefined
    if (errors.length && override) {
        if (typeof override === 'function') {
            const overridden: Errors.ErrorItem | Errors.ErrorItem[] = override(errors)
            errors = Array.isArray(overridden) ? overridden : [overridden]
            for (const error of errors) assert(error instanceof Error || error instanceof Errors.Report, 'error() must return an Error object')
        } else {
            errors = [override]
        }
    }
    //Default
    if (value === undefined) {
        const defaulted: unknown = defaultValue('default', value, errors, helpers)
        state.mainstay.tracer.value(state, 'default', value, defaulted)
        value = defaulted
    }
    //Cast
    if (schema._flags.cast && value !== undefined) {
        const caster: CastDefinition = schema._definition.cast[schema._flags.cast as string]
        if (caster.from(value)) {
            const casted: unknown = caster.to(value, helpers)
            state.mainstay.tracer.value(state, 'cast', value, casted, schema._flags.cast as string)
            value = casted
        }
    }
    //Externals
    //Disabled for matching
    if (schema.$_terms.externals && prefs.externals && prefs._externals !== false) {
        for (const {method} of schema.$_terms.externals as { method: ExternalMethod }[]) state.mainstay.externals.push({method, schema, state, label: Errors.label(schema._flags, state, prefs, undefined)})
    }
    //Result
    const result: SchemaResult = {value, errors: errors.length ? errors : null}
    if (schema._flags.result) {
        result.value = schema._flags.result === 'strip' ? undefined : /* raw */ helpers.original
        state.mainstay.tracer.value(state, schema._flags.result as string, value, result.value)
        state.shadow(value, schema._flags.result as string)
    }
    //Cache
    if (schema._cache && prefs.cache !== false && !schema._refs.length) schema._cache.set(helpers.original, result)
    //Artifacts
    if (value !== undefined && !result.errors && schema._flags.artifact !== undefined) {
        state.mainstay.artifacts = state.mainstay.artifacts || new Map()
        if (!state.mainstay.artifacts.has(schema._flags.artifact)) state.mainstay.artifacts.set(schema._flags.artifact, [])
        ;(state.mainstay.artifacts.get(schema._flags.artifact) as PathKey[][]).push(state.path)
    }
    return result
}

type CachedPreferences = Preferences & { [key: symbol]: Preferences | undefined }

/**
 * The preferences of schemas merged with their parent preferences, by schema preferences then by parent preferences
 * (lakutata: upstream caches only the merge with the default preferences). Merged preferences are never mutated.
 */
const mergedPreferences: WeakMap<Preferences, WeakMap<Preferences, Preferences>> = new WeakMap()

function prefsOf(schema: SchemaInternals, prefs: Preferences): Preferences {
    const preferences: CachedPreferences = schema._preferences as CachedPreferences
    const isDefaultOptions: boolean = prefs === Common.defaults
    if (isDefaultOptions && preferences[Common.symbols.prefs]) return preferences[Common.symbols.prefs] as Preferences
    let byParent: WeakMap<Preferences, Preferences> | undefined = mergedPreferences.get(preferences)
    const cached: Preferences | undefined = byParent && byParent.get(prefs)
    if (cached) return cached
    const merged: Preferences = Common.preferences(prefs, preferences)
    if (isDefaultOptions) {
        preferences[Common.symbols.prefs] = merged
    } else {
        if (!byParent) {
            byParent = new WeakMap()
            mergedPreferences.set(preferences, byParent)
        }
        byParent.set(prefs, merged)
    }
    return merged
}

/**
 * The validation settings (the defaults merged with the validate() options) by options, for the options which cannot
 * change: frozen, with primitive values only (lakutata: the settings are reused across validations, so the schema
 * preferences merged with them are reused too). Merged preferences are never mutated.
 */
const settingsByOptions: WeakMap<Preferences, Preferences> = new WeakMap()

/**
 * The validation settings which never change (the defaults, and the settings of options which cannot change): the fast
 * path compiles the schemas for them
 */
const stableSettings: WeakSet<Preferences> = new WeakSet([Common.defaults])

/**
 * The mode of the validation fast path (fastpath.ts): 'on' (the default), 'off' (interpreter only), or 'verify' (both
 * run, for any settings, and a different result throws: for tests)
 */
export type FastPathMode = 'on' | 'off' | 'verify'

let fastPathMode: FastPathMode = 'on'

/**
 * Set the mode of the validation fast path
 * @param mode
 */
export function setFastPathMode(mode: FastPathMode): void {
    fastPathMode = mode
}

/**
 * The value validated by the fast path, or FALLBACK (the interpreter must validate it)
 * @param value
 * @param schema
 * @param settings
 */
function fastPath(value: unknown, schema: SchemaInternals, settings: Preferences): unknown {
    if (fastPathMode === 'off' || schema.$_root._tracer) return FALLBACK
    if (fastPathMode === 'on' && !stableSettings.has(settings)) return FALLBACK
    const compiled: ((value: unknown) => unknown) | null = compiledFor(schema, settings)
    return compiled ? compiled(value) : FALLBACK
}

/**
 * Check (verify mode) that the interpreter validated the value like the fast path
 * @param value
 * @param fast
 * @param result
 */
function verifyFastPath(value: unknown, fast: unknown, result: EntryResult): void {
    if (fast === FALLBACK) return
    if (fast === INVALID) {
        if (!result.error) throw new Error('Validation fast path mismatch: invalid for the fast path, valid for the interpreter')
        return
    }
    if (result.error || !sameResult(fast, result.value, value)) throw new Error(`Validation fast path mismatch: ${result.error ? result.error.message : 'different value'}`)
}

/**
 * Whether options cannot change: frozen, without symbol keys, with primitive values only
 * @param prefs
 */
function isImmutableOptions(prefs: Preferences): boolean {
    if (!Object.isFrozen(prefs) || Object.getOwnPropertySymbols(prefs).length) return false
    for (const name of Object.keys(prefs)) {
        const value: unknown = (prefs as Record<string, unknown>)[name]
        if ((value !== null && typeof value === 'object') || typeof value === 'function') return false
    }
    return true
}

/**
 * The defaults merged with the validate() options
 * @param prefs
 */
function entrySettings(prefs: Preferences): Preferences {
    const cached: Preferences | undefined = settingsByOptions.get(prefs)
    if (cached) return cached
    const settings: Preferences = Common.preferences(Common.defaults, prefs)
    if (isImmutableOptions(prefs)) {
        settingsByOptions.set(prefs, settings)
        stableSettings.add(settings)
    }
    return settings
}

/**
 * A default (or failover) function: called with a clone of the parent value and the helpers
 */
type DefaultMethod = (...args: unknown[]) => unknown

function defaultValue(flag: 'default' | 'failover', value: unknown, errors: Errors.ErrorItem[], helpers: ValidationHelpers): unknown {
    const {schema, state, prefs} = helpers
    const source: unknown = schema._flags[flag]
    if (prefs.noDefaults || source === undefined) return value
    state.mainstay.tracer.log(schema, state, 'rule', flag, 'full')
    if (!source) return source
    if (typeof source === 'function') {
        const args: unknown[] = source.length ? [clone(state.ancestors[0]), helpers] : []
        try {
            return (source as DefaultMethod)(...args)
        } catch (err) {
            errors.push(schema.$_createError(`any.${flag}`, null, {error: err}, state, prefs))
            return
        }
    }
    if (typeof source !== 'object') return source
    if ((source as Record<symbol, unknown>)[Common.symbols.literal]) return (source as { literal: unknown }).literal
    if (Common.isResolvable(source)) return (source as Resolvable).resolve(value, state, prefs)
    return clone(source)
}

function trim(value: unknown, schema: SchemaInternals): unknown {
    if (typeof value !== 'string') return value
    const trimRule: SchemaRule | undefined = schema.$_getRule('trim')
    if (!trimRule || !(trimRule.args as Record<string, unknown>).enabled) return value
    return value.trim()
}

const ignoreTracer: ValidationTracer = {
    active: false,
    debug: ignore,
    entry: ignore,
    filter: ignore,
    log: ignore,
    resolve: ignore,
    value: ignore
}

function errorsArray(): Errors.ErrorItem[] {
    const errors: Errors.ErrorItem[] = []
    ;(errors as Errors.ErrorItem[] & Record<symbol, boolean>)[Common.symbols.errors] = true
    return errors
}
