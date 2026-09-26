/**
 * Derived from joi 18.0.2 lib/trace.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {deepEqual} from '../hoek/index.js'
import * as Pinpoint from '../pinpoint/index.js'
import * as Errors from './errors.js'
import type {ModifyEachSource} from './modify.js'
import type {MainstayLike, PathKey, SchemaInternals, StateLike} from './model.js'
import type {ResolvableValue, Values} from './values.js'

type TraceResult = 'error' | 'pass' | 'full'

const codes: Record<TraceResult, number> = {
    error: 1,
    pass: 2,
    full: 3
}

const labels: Record<number, string> = {
    0: 'never used',
    1: 'always error',
    2: 'always pass'
}

/**
 * A segment of a sub schema path: an id or key, or a [@term, position] pair
 */
type TracePathSegment = string | [string, PathKey]

type TracePath = TracePathSegment[]

/**
 * A debug event of a validation
 */
export interface DebugEvent {
    type: string
    path?: unknown[]
    [name: string]: unknown
}

/**
 * The state parts the tracer reads
 */
export interface TraceState extends StateLike {
    debug?: unknown
    mainstay: MainstayLike & { debug?: DebugEvent[] | null }
}

/**
 * A resolvable value, as the tracer displays it
 */
interface DisplayedResolvable extends ResolvableValue {
    display?: string
}

/**
 * A matched value of a values set
 */
interface ValuesFilter {
    value: unknown
    ref?: DisplayedResolvable
}

/**
 * The coverage log of one (sub) schema
 */
interface SourceLog {
    paths: Set<TracePath>
    entry: boolean
    rule: Record<string, number>
    valid: Set<ValuesFilter>
    invalid: Set<ValuesFilter>
}

/**
 * A missing coverage item
 */
interface MissingItem {
    status: string | unknown[]
    paths?: TracePath[]
    rule?: string
}

/**
 * The coverage report of one registered schema
 */
export interface CoverageReport {
    filename: string
    line: number
    missing: MissingItem[]
    severity: 'error'
    message: string
}

interface RegisteredSchema {
    filename: string
    line: number
    store: Store
}

/**
 * The root object parts set by setup()
 */
export interface TraceRoot {
    _tracer?: Tracer | null
    trace?: () => Tracer
    untrace?: () => void
}

/**
 * Add trace() and untrace() to the root object
 * @param root
 */
export function setup(root: TraceRoot): void {
    const trace = function (): Tracer {
        root._tracer = root._tracer || new Tracer()
        return root._tracer
    }
    root.trace = trace
    root.untrace = (): void => {
        root._tracer = null
    }
}

/**
 * Record the location of the caller of schema.tracer()
 * @param schema
 */
export function location<T extends SchemaInternals>(schema: T): T {
    //base.tracer(), caller
    return schema.$_setFlag('_tracerLocation', Pinpoint.location(2))
}

/**
 * Collects the coverage of the traced schemas
 */
export class Tracer {

    public name: string

    protected _schemas: Map<SchemaInternals, RegisteredSchema>

    constructor() {
        this.name = 'lakutata'
        this._schemas = new Map()
    }

    public _register(schema: SchemaInternals): Store {
        const existing: RegisteredSchema | undefined = this._schemas.get(schema)
        if (existing) return existing.store
        const store: Store = new Store(schema)
        //internals.tracer(), internals.entry(), $exports.entry(), validate(), caller
        const {filename, line} = schema._flags._tracerLocation as Pinpoint.Location | undefined || Pinpoint.location(5)
        this._schemas.set(schema, {filename, line, store})
        return store
    }

    public _combine(merged: SchemaInternals, sources: SchemaInternals[]): void {
        for (const {store} of this._schemas.values()) store._combine(merged, sources)
    }

    public report(file?: string): CoverageReport[] | null {
        const coverage: CoverageReport[] = []
        //Process each registered schema
        for (const {filename, line, store} of this._schemas.values()) {
            if (file && file !== filename) continue
            //Process sub schemas of the registered root
            const missing: MissingItem[] = []
            const skipped: TracePath[] = []
            for (const [schema, log] of store._sources.entries()) {
                //Check if sub schema parent skipped
                if (sub(log.paths, skipped)) continue
                //Check if sub schema reached
                if (!log.entry) {
                    missing.push({
                        status: 'never reached',
                        paths: [...log.paths]
                    })
                    skipped.push(...log.paths)
                    continue
                }
                //Check values
                for (const type of ['valid', 'invalid'] as const) {
                    const set: Values | null = schema[`_${type}s`]
                    if (!set) continue
                    const values: Set<unknown> = new Set(set._values)
                    const refs: Set<DisplayedResolvable> = new Set(set._refs)
                    for (const {value, ref} of log[type]) {
                        values.delete(value)
                        refs.delete(ref as DisplayedResolvable)
                    }
                    if (values.size || refs.size) {
                        missing.push({
                            status: [...values, ...[...refs].map((ref: DisplayedResolvable): string | undefined => ref.display)],
                            rule: `${type}s`
                        })
                    }
                }
                //Check rules status
                const rules: string[] = schema._rules.map((rule: { name: string }): string => rule.name)
                for (const type of ['default', 'failover']) {
                    if (schema._flags[type] !== undefined) rules.push(type)
                }
                for (const name of rules) {
                    const status: string | undefined = labels[log.rule[name] || 0]
                    if (status) {
                        const report: MissingItem = {rule: name, status}
                        if (log.paths.size) report.paths = [...log.paths]
                        missing.push(report)
                    }
                }
            }
            if (missing.length) {
                coverage.push({
                    filename,
                    line,
                    missing,
                    severity: 'error',
                    message: `Schema missing tests for ${missing.map(message).join(', ')}`
                })
            }
        }
        return coverage.length ? coverage : null
    }
}

/**
 * The coverage store of a registered schema, recording the validations of its sub schemas
 */
export class Store {

    public active: boolean

    //schema -> { paths, entry, rule, valid, invalid }
    public _sources: Map<SchemaInternals, SourceLog>

    //merged -> [sources]
    protected _combos: Map<SchemaInternals, SchemaInternals[]>

    constructor(schema: SchemaInternals) {
        this.active = true
        this._sources = new Map()
        this._combos = new Map()
        this._scan(schema)
    }

    public debug(state: TraceState, source: string, name: string, result: unknown): void {
        state.mainstay.debug && state.mainstay.debug.push({type: source, name, result, path: state.path})
    }

    public entry(schema: SchemaInternals, state: TraceState): void {
        debug(state, {type: 'entry'})
        this._record(schema, (log: SourceLog): void => {
            log.entry = true
        })
    }

    public filter(schema: SchemaInternals, state: TraceState, source: 'valid' | 'invalid', value: ValuesFilter): void {
        debug(state, {type: source, ...value})
        this._record(schema, (log: SourceLog): void => {
            log[source].add(value)
        })
    }

    public log(schema: SchemaInternals, state: TraceState, source: 'rule', name: string, result: TraceResult): void {
        debug(state, {type: source, name, result: result === 'full' ? 'pass' : result})
        this._record(schema, (log: SourceLog): void => {
            log[source][name] = log[source][name] || 0
            log[source][name] |= codes[result]
        })
    }

    public resolve(state: TraceState, ref: { display?: string }, to: unknown): void {
        if (!state.mainstay.debug) return
        const log: DebugEvent = {type: 'resolve', ref: ref.display, to, path: state.path}
        state.mainstay.debug.push(log)
    }

    public value(state: TraceState, by: string, from: unknown, to: unknown, name?: string): void {
        if (!state.mainstay.debug || deepEqual(from, to)) return
        const log: DebugEvent = {type: 'value', by, from, to, path: state.path}
        if (name) log.name = name
        state.mainstay.debug.push(log)
    }

    public _record(schema: SchemaInternals, each: (log: SourceLog) => void): void {
        const log: SourceLog | undefined = this._sources.get(schema)
        if (log) {
            each(log)
            return
        }
        //Like upstream: a schema neither scanned nor combined is not expected here
        const sources: SchemaInternals[] = this._combos.get(schema) as SchemaInternals[]
        for (const source of sources) this._record(source, each)
    }

    public _scan(schema: SchemaInternals, _path?: TracePath): void {
        const path: TracePath = _path || []
        let log: SourceLog | undefined = this._sources.get(schema)
        if (!log) {
            log = {
                paths: new Set(),
                entry: false,
                rule: {},
                valid: new Set(),
                invalid: new Set()
            }
            this._sources.set(schema, log)
        }
        if (path.length) log.paths.add(path)
        const each = (sub: unknown, source: ModifyEachSource): void => {
            const subId: TracePathSegment = id(sub as SchemaInternals, source)
            this._scan(sub as SchemaInternals, path.concat(subId))
        }
        schema.$_modify({each, ref: false})
    }

    public _combine(merged: SchemaInternals, sources: SchemaInternals[]): void {
        this._combos.set(merged, sources)
    }
}

function message(item: MissingItem): string {
    const path: string = item.paths ? Errors.path(item.paths[0] as PathKey[]) + (item.rule ? ':' : '') : ''
    return `${path}${item.rule || ''} (${item.status})`
}

function id(schema: SchemaInternals, {source, name, path, key}: ModifyEachSource): TracePathSegment {
    if (schema._flags.id) return schema._flags.id
    if (key) return key
    name = `@${name}`
    if (source === 'terms') return [name, path[Math.min(path.length - 1, 1)]]
    return name
}

function sub(paths: Set<TracePath>, skipped: TracePath[]): boolean {
    for (const path of paths) {
        for (const skip of skipped) {
            if (deepEqual(path.slice(0, skip.length), skip)) return true
        }
    }
    return false
}

function debug(state: TraceState, event: DebugEvent): void {
    if (state.mainstay.debug) {
        event.path = state.debug ? [...state.path, state.debug] : state.path
        state.mainstay.debug.push(event)
    }
}
