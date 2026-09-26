/**
 * Derived from joi 18.0.2 lib/base.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, clone, deepEqual, merge} from '../hoek/index.js'
import * as Cache from './cache.js'
import * as Common from './common.js'
import * as Compile from './compile.js'
import * as Errors from './errors.js'
import * as Extend from './extend.js'
import * as Manifest from './manifest.js'
import * as Messages from './messages.js'
import * as Modify from './modify.js'
import type {
    CacheLike,
    PathKey,
    Preferences,
    RootLike,
    SchemaFlags,
    SchemaInternals,
    SchemaRule,
    SchemaRuleOptions,
    SchemaTemp
} from './model.js'
import * as Ref from './ref.js'
import type {State} from './state.js'
import * as Trace from './trace.js'
import * as Validator from './validator.js'
import {Values} from './values.js'

/**
 * The terms of a schema (hash of arrays of immutable objects, extended by other types)
 */
export type SchemaTerms = { [name: string]: unknown }

/**
 * A term collection which can be copied and concatenated (an array, or a term specific collection)
 */
interface TermCollection {
    slice(): TermCollection
    concat(source: TermCollection): TermCollection
}

/**
 * An item of the whens term: a condition, a switch statement, or a schema to concatenate (links)
 */
export interface WhenTerm {
    concat?: Base
    ref?: Ref.Ref
    is?: Base
    then?: Base
    otherwise?: Base
    switch?: Compile.WhenCase[]
    break?: boolean
}

/**
 * An item of the alterations term
 */
export interface AlterationTerm {
    target: string
    adjuster: (schema: Base) => Base
}

/**
 * An item of the externals term
 */
export interface ExternalTerm {
    method: Validator.ExternalMethod
    description?: string
}

export interface DefaultOptions {
    literal?: boolean
}

export interface InnerOptions {
    single?: boolean
    override?: boolean
}

/**
 * A Standard Schema (https://standardschema.dev) issue
 */
export interface StandardIssue {
    message: string
    path?: PathKey[]
}

export type StandardResult = { value: unknown } | { issues: StandardIssue[] }

/**
 * The Standard Schema interface of a schema
 */
export interface StandardSchema {
    version: 1
    vendor: 'joi'
    validate(value: unknown): StandardResult | Promise<StandardResult>
}

/**
 * A schema method, looked up by name
 */
type SchemaMethod = (this: Base, ...args: unknown[]) => unknown

/**
 * The base schema: rules, flags, terms and validation shared by all the types
 */
export class Base implements SchemaInternals {

    //Naming: public, _private, $_extension, $_mutate{action}

    public type: string

    public $_root: RootLike

    public _definition: Extend.Definition<Base>

    public _ids: Modify.Ids

    public _preferences: Preferences | null

    public _refs: Ref.Manager

    public _cache: CacheLike | null

    public _valids: Values | null

    public _invalids: Values | null

    public _flags: SchemaFlags

    public _rules: SchemaRule[]

    //The rule options passed for non-multi rules
    public _singleRules: Map<string, SchemaRule>

    //Hash of arrays of immutable objects (extended by other types)
    public $_terms: SchemaTerms

    //Runtime state (not cloned)
    public $_temp: SchemaTemp

    //Backwards compatibility: the overridden methods, bound to the schema
    public $_super: Record<string, Function>

    //Set on the prototype of the types with overrides: the prototype of their parent type
    declare public _super: Record<string, Function>

    //Prevents Hoek from deep cloning schema objects (must be on prototype)
    declare public isImmutable: true

    declare public deny: Base['invalid']

    declare public disallow: Base['invalid']

    declare public equal: Base['valid']

    declare public exist: Base['required']

    declare public not: Base['invalid']

    declare public options: Base['prefs']

    declare public preferences: Base['prefs']

    constructor(type?: string) {
        this.type = type as string
        this.$_root = null as unknown as RootLike
        this._definition = {} as Extend.Definition<Base>
        this._reset()
    }

    public _reset(): void {
        this._ids = new Modify.Ids()
        this._preferences = null
        this._refs = new Ref.Manager()
        this._cache = null
        this._valids = null
        this._invalids = null
        this._flags = {}
        this._rules = []
        this._singleRules = new Map()
        this.$_terms = {}
        this.$_temp = {
            ruleset: null,
            whens: {}
        }
    }

    //Manifest

    public describe(): Manifest.SchemaDescription {
        assert(typeof Manifest.describe === 'function', 'Manifest functionality disabled')
        return Manifest.describe(this)
    }

    //Rules

    public allow(...values: unknown[]): this {
        Common.verifyFlat(values, 'allow')
        return this._values(values, '_valids')
    }

    public alter(targets: Record<string, (schema: Base) => Base>): this {
        assert(targets && typeof targets === 'object' && !Array.isArray(targets), 'Invalid targets argument')
        assert(!this._inRuleset(), 'Cannot set alterations inside a ruleset')
        const obj: this = this.clone()
        obj.$_terms.alterations = obj.$_terms.alterations || []
        for (const target in targets) {
            const adjuster: (schema: Base) => Base = targets[target]
            assert(typeof adjuster === 'function', 'Alteration adjuster for', target, 'must be a function')
            ;(obj.$_terms.alterations as AlterationTerm[]).push({target, adjuster})
        }
        obj.$_temp.ruleset = false
        return obj
    }

    public artifact(id: unknown): this {
        assert(id !== undefined, 'Artifact cannot be undefined')
        assert(!this._cache, 'Cannot set an artifact with a rule cache')
        return this.$_setFlag('artifact', id)
    }

    public cast(to: string | false): this {
        assert(to === false || typeof to === 'string', 'Invalid to value')
        assert(to === false || this._definition.cast[to], 'Type', this.type, 'does not support casting to', to)
        return this.$_setFlag('cast', to === false ? undefined : to)
    }

    public default(value?: unknown, options?: DefaultOptions): this {
        return this._default('default', value, options)
    }

    public description(desc: string): this {
        assert(desc && typeof desc === 'string', 'Description must be a non-empty string')
        return this.$_setFlag('description', desc)
    }

    public empty(schema?: unknown): this {
        const obj: this = this.clone()
        if (schema !== undefined) schema = obj.$_compile(schema, {override: false})
        return obj.$_setFlag('empty', schema, {clone: false})
    }

    public error(err: Error | ((errors: Errors.ErrorItem[]) => Errors.ErrorItem | Errors.ErrorItem[])): this {
        assert(err, 'Missing error')
        assert(err instanceof Error || typeof err === 'function', 'Must provide a valid Error object or a function')
        return this.$_setFlag('error', err)
    }

    public example(example: unknown, options: { override?: boolean } = {}): this {
        assert(example !== undefined, 'Missing example')
        Common.assertOptions(options, ['override'])
        return this._inner('examples', example, {single: true, override: options.override})
    }

    public external(method: Validator.ExternalMethod | ExternalTerm, description?: string): this {
        if (typeof method === 'object') {
            assert(!description, 'Cannot combine options with description')
            description = method.description
            method = method.method
        }
        assert(typeof method === 'function', 'Method must be a function')
        assert(description === undefined || description && typeof description === 'string', 'Description must be a non-empty string')
        return this._inner('externals', {method, description}, {single: true})
    }

    public failover(value?: unknown, options?: DefaultOptions): this {
        return this._default('failover', value, options)
    }

    public forbidden(): this {
        return this.presence('forbidden')
    }

    public id(id?: string): this {
        if (!id) return this.$_setFlag('id', undefined)
        assert(typeof id === 'string', 'id must be a non-empty string')
        assert(/^[^\.]+$/.test(id), 'id cannot contain period character')
        return this.$_setFlag('id', id)
    }

    public invalid(...values: unknown[]): this {
        return this._values(values, '_invalids')
    }

    public label(name: string): this {
        assert(name && typeof name === 'string', 'Label name must be a non-empty string')
        return this.$_setFlag('label', name)
    }

    public meta(meta: unknown): this {
        assert(meta !== undefined, 'Meta cannot be undefined')
        return this._inner('metas', meta, {single: true})
    }

    public note(...notes: string[]): this {
        assert(notes.length, 'Missing notes')
        for (const note of notes) assert(note && typeof note === 'string', 'Notes must be non-empty strings')
        return this._inner('notes', notes)
    }

    public only(mode: boolean = true): this {
        assert(typeof mode === 'boolean', 'Invalid mode:', mode)
        return this.$_setFlag('only', mode)
    }

    public optional(): this {
        return this.presence('optional')
    }

    public prefs(prefs: Preferences): this {
        assert(prefs, 'Missing preferences')
        assert(prefs.context === undefined, 'Cannot override context')
        assert(prefs.externals === undefined, 'Cannot override externals')
        assert(prefs.warnings === undefined, 'Cannot override warnings')
        assert(prefs.debug === undefined, 'Cannot override debug')
        Common.checkPreferences(prefs)
        const obj: this = this.clone()
        obj._preferences = Common.preferences(obj._preferences, prefs)
        return obj
    }

    public presence(mode: NonNullable<Preferences['presence']>): this {
        assert(['optional', 'required', 'forbidden'].includes(mode), 'Unknown presence mode', mode)
        return this.$_setFlag('presence', mode)
    }

    public raw(enabled: boolean = true): this {
        return this.$_setFlag('result', enabled ? 'raw' : undefined)
    }

    public result(mode: 'raw' | 'strip'): this {
        assert(['raw', 'strip'].includes(mode), 'Unknown result mode', mode)
        return this.$_setFlag('result', mode)
    }

    public required(): this {
        return this.presence('required')
    }

    public strict(enabled?: boolean): this {
        const obj: this = this.clone()
        const convert: boolean = enabled === undefined ? false : !enabled
        obj._preferences = Common.preferences(obj._preferences, {convert})
        return obj
    }

    public strip(enabled: boolean = true): this {
        return this.$_setFlag('result', enabled ? 'strip' : undefined)
    }

    public tag(...tags: string[]): this {
        assert(tags.length, 'Missing tags')
        for (const tag of tags) assert(tag && typeof tag === 'string', 'Tags must be non-empty strings')
        return this._inner('tags', tags)
    }

    public unit(name: string): this {
        assert(name && typeof name === 'string', 'Unit name must be a non-empty string')
        return this.$_setFlag('unit', name)
    }

    public valid(...values: unknown[]): this {
        Common.verifyFlat(values, 'valid')
        const obj: this = this.allow(...values)
        obj.$_setFlag('only', !!obj._valids, {clone: false})
        return obj
    }

    public when(condition: unknown, options?: Compile.WhenOptions | Compile.WhenSwitchCase[]): this {
        const obj: this = this.clone()
        if (!obj.$_terms.whens) obj.$_terms.whens = []
        const when: Compile.WhenCondition | Compile.WhenSwitch = Compile.when(obj, condition, options)
        if (!['any', 'link'].includes(obj.type)) {
            const conditions: (Compile.WhenCondition | Compile.WhenCase)[] = (when as Compile.WhenCondition).is ? [when as Compile.WhenCondition] : (when as Compile.WhenSwitch).switch
            for (const item of conditions) {
                assert(!item.then || item.then.type === 'any' || item.then.type === obj.type, 'Cannot combine', obj.type, 'with', item.then && item.then.type)
                assert(!item.otherwise || item.otherwise.type === 'any' || item.otherwise.type === obj.type, 'Cannot combine', obj.type, 'with', item.otherwise && item.otherwise.type)
            }
        }
        ;(obj.$_terms.whens as unknown[]).push(when)
        return obj.$_mutateRebuild()
    }

    //Helpers

    public cache(cache?: CacheLike): this {
        assert(!this._inRuleset(), 'Cannot set caching inside a ruleset')
        assert(!this._cache, 'Cannot override schema cache')
        assert(this._flags.artifact === undefined, 'Cannot cache a rule with an artifact')
        const obj: this = this.clone()
        obj._cache = cache || Cache.provider.provision()
        obj.$_temp.ruleset = false
        return obj
    }

    public clone(): this {
        const obj: this = Object.create(Object.getPrototypeOf(this))
        return this._assign(obj)
    }

    public concat(source: Base): this {
        assert(Common.isSchema(source), 'Invalid schema object')
        assert(this.type === 'any' || source.type === 'any' || source.type === this.type, 'Cannot merge type', this.type, 'with another type:', source.type)
        assert(!this._inRuleset(), 'Cannot concatenate onto a schema with open ruleset')
        assert(!source._inRuleset(), 'Cannot concatenate a schema with open ruleset')
        let obj: this = this.clone()
        if (this.type === 'any' && source.type !== 'any') {
            //Change obj to match source type
            const tmpObj: Record<string, unknown> = source.clone() as unknown as Record<string, unknown>
            for (const key of Object.keys(obj)) {
                if (key !== 'type') tmpObj[key] = (obj as unknown as Record<string, unknown>)[key]
            }
            obj = tmpObj as unknown as this
        }
        obj._ids.concat(source._ids)
        obj._refs.register(source, Ref.toSibling)
        obj._preferences = obj._preferences ? Common.preferences(obj._preferences, source._preferences) : source._preferences
        obj._valids = Values.merge(obj._valids, source._valids, source._invalids)
        obj._invalids = Values.merge(obj._invalids, source._invalids, source._valids)
        //Remove unique rules present in source
        for (const name of source._singleRules.keys()) {
            if (obj._singleRules.has(name)) {
                obj._rules = obj._rules.filter((target: SchemaRule): unknown => target.keep || target.name !== name)
                obj._singleRules.delete(name)
            }
        }
        //Rules
        for (const test of source._rules) {
            if (!source._definition.rules[test.method].multi) obj._singleRules.set(test.name, test)
            obj._rules.push(test)
        }
        //Flags
        if (obj._flags.empty && source._flags.empty) {
            obj._flags.empty = (obj._flags.empty as Base).concat(source._flags.empty as Base)
            const flags: SchemaFlags = Object.assign({}, source._flags)
            delete flags.empty
            merge(obj._flags, flags)
        } else if (source._flags.empty) {
            obj._flags.empty = source._flags.empty
            const flags: SchemaFlags = Object.assign({}, source._flags)
            delete flags.empty
            merge(obj._flags, flags)
        } else {
            merge(obj._flags, source._flags)
        }
        //Terms
        for (const key in source.$_terms) {
            const terms: TermCollection | null | undefined = source.$_terms[key] as TermCollection | null | undefined
            if (!terms) {
                if (!obj.$_terms[key]) obj.$_terms[key] = terms
                continue
            }
            if (!obj.$_terms[key]) {
                obj.$_terms[key] = terms.slice()
                continue
            }
            obj.$_terms[key] = (obj.$_terms[key] as TermCollection).concat(terms)
        }
        //Tracing
        if (this.$_root._tracer) this.$_root._tracer._combine(obj, [this, source])
        //Rebuild
        return obj.$_mutateRebuild()
    }

    public extend(options: Extend.TypeDefinition<this>): this {
        assert(!options.base, 'Cannot extend type with another base')
        return Extend.type(this, options)
    }

    public extract(path: string | string[]): SchemaInternals {
        path = Array.isArray(path) ? path : path.split('.')
        return this._ids.reach(path)
    }

    public fork(paths: string | string[] | (string | string[])[], adjuster: (schema: SchemaInternals) => SchemaInternals): this {
        assert(!this._inRuleset(), 'Cannot fork inside a ruleset')
        let obj: this = this
        for (let path of ([] as (string | string[])[]).concat(paths)) {
            path = Array.isArray(path) ? path : path.split('.')
            obj = obj._ids.fork(path, adjuster, obj) as this
        }
        obj.$_temp.ruleset = false
        return obj
    }

    public isAsync(): boolean {
        if (Boolean((this.$_terms.externals as ExternalTerm[] | null | undefined)?.length)) return true
        if (this.$_terms.whens) {
            for (const when of this.$_terms.whens as WhenTerm[]) {
                if (when.then?.isAsync()) return true
                if (when.otherwise?.isAsync()) return true
                if (when.switch) {
                    for (const item of when.switch) {
                        if ((item.then as Base | undefined)?.isAsync()) return true
                        if ((item.otherwise as Base | undefined)?.isAsync()) return true
                    }
                }
            }
        }
        return false
    }

    public rule(options: Record<string, unknown>): this {
        const def: Extend.Definition<Base> = this._definition
        Common.assertOptions(options, Object.keys(def.modifiers))
        assert(this.$_temp.ruleset !== false, 'Cannot apply rules to empty ruleset or the last rule added does not support rule properties')
        const start: number = this.$_temp.ruleset === null ? this._rules.length - 1 : this.$_temp.ruleset
        assert(start >= 0 && start < this._rules.length, 'Cannot apply rules to empty ruleset')
        const obj: this = this.clone()
        for (let i: number = start; i < obj._rules.length; ++i) {
            const original: SchemaRule = obj._rules[i]
            const rule: SchemaRule = clone(original)
            for (const name in options) {
                def.modifiers[name](rule, options[name])
                assert(rule.name === original.name, 'Cannot change rule name')
            }
            obj._rules[i] = rule
            if (obj._singleRules.get(rule.name) === original) obj._singleRules.set(rule.name, rule)
        }
        obj.$_temp.ruleset = false
        return obj.$_mutateRebuild()
    }

    public get ruleset(): this {
        assert(!this._inRuleset(), 'Cannot start a new ruleset without closing the previous one')
        const obj: this = this.clone()
        obj.$_temp.ruleset = obj._rules.length
        return obj
    }

    public get $(): this {
        return this.ruleset
    }

    public tailor(targets: string | string[]): this {
        targets = ([] as string[]).concat(targets)
        assert(!this._inRuleset(), 'Cannot tailor inside a ruleset')
        let obj: this = this
        if (this.$_terms.alterations) {
            for (const {target, adjuster} of this.$_terms.alterations as AlterationTerm[]) {
                if (targets.includes(target)) {
                    obj = adjuster(obj) as this
                    assert(Common.isSchema(obj), 'Alteration adjuster for', target, 'failed to return a schema object')
                }
            }
        }
        obj = obj.$_modify({each: (item: unknown): unknown => (item as Base).tailor(targets), ref: false})
        obj.$_temp.ruleset = false
        return obj.$_mutateRebuild()
    }

    public tracer(): this {
        return Trace.location ? Trace.location(this) : this
    }

    public validate(value: unknown, options?: Preferences): Validator.ValidationResult {
        return Validator.entry(value, this, options)
    }

    public validateAsync(value: unknown, options?: Preferences): Promise<unknown> {
        return Validator.entryAsync(value, this, options)
    }

    //Extensions

    public $_addRule(options: string | SchemaRuleOptions): this {
        //Normalize rule
        if (typeof options === 'string') options = {name: options}
        assert(options && typeof options === 'object', 'Invalid options')
        assert(options.name && typeof options.name === 'string', 'Invalid rule name')
        for (const key in options) assert(key[0] !== '_', 'Cannot set private rule properties')
        //Shallow cloned
        const rule: SchemaRule = Object.assign({}, options) as SchemaRule
        rule._resolve = []
        rule.method = rule.method || rule.name
        const definition: Extend.ExtendedRuleDefinition<Base> = this._definition.rules[rule.method]
        const args: Record<string, unknown> | null | undefined = rule.args
        assert(definition, 'Unknown rule', rule.method)
        //Args
        const obj: this = this.clone()
        if (args) {
            assert(Object.keys(args).length === 1 || Object.keys(args).length === (this._definition.rules[rule.name].args as Extend.RuleArgDefinition[]).length, 'Invalid rule definition for', this.type, rule.name)
            for (const key in args) {
                let arg: unknown = args[key]
                if (definition.argsByName) {
                    const resolver: Extend.RuleArgDefinition = definition.argsByName.get(key) as Extend.RuleArgDefinition
                    if (resolver.ref && Common.isResolvable(arg)) {
                        rule._resolve.push(key)
                        obj.$_mutateRegister(arg)
                    } else {
                        if (resolver.normalize) {
                            arg = resolver.normalize(arg)
                            args[key] = arg
                        }
                        if (resolver.assert) {
                            const error: string | undefined = Common.validateArg(arg, key, resolver as Extend.RuleArgDefinition & Required<Pick<Extend.RuleArgDefinition, 'assert'>>)
                            assert(!error, error, 'or reference')
                        }
                    }
                }
                if (arg === undefined) {
                    delete args[key]
                    continue
                }
                args[key] = arg
            }
        }
        //Unique rules
        if (!definition.multi) {
            obj._ruleRemove(rule.name, {clone: false})
            obj._singleRules.set(rule.name, rule)
        }
        if (obj.$_temp.ruleset === false) obj.$_temp.ruleset = null
        if (definition.priority) {
            obj._rules.unshift(rule)
        } else {
            obj._rules.push(rule)
        }
        return obj
    }

    public $_compile(schema: unknown, options?: Compile.SchemaOptions): Base {
        return Compile.schema(this.$_root, schema, options) as Base
    }

    public $_createError(code: string, value: unknown, local: Errors.ReportLocal | null | undefined, state: State, prefs: Preferences, options: { flags?: boolean, messages?: Messages.MessagesInput } = {}): Errors.Report {
        const flags: SchemaFlags = options.flags !== false ? this._flags : {}
        const messages: Messages.Messages | null | undefined = options.messages ? Messages.merge(this._definition.messages, options.messages) : this._definition.messages
        return new Errors.Report(code, value, local, flags, messages, state, prefs)
    }

    public $_getFlag(name: string): unknown {
        return this._flags[name]
    }

    public $_getRule(name: string): SchemaRule | undefined {
        return this._singleRules.get(name)
    }

    public $_mapLabels(path: string | string[]): string {
        path = Array.isArray(path) ? path : path.split('.')
        return this._ids.labels(path)
    }

    public $_match(value: unknown, state: State, prefs: Preferences, overrides?: { presence?: Preferences['presence'] }): boolean {
        //Shallow cloned
        prefs = Object.assign({}, prefs)
        prefs.abortEarly = true
        prefs._externals = false
        state.snapshot()
        const result: boolean = !Validator.validate(value, this, state, prefs, overrides).errors
        state.restore()
        return result
    }

    public $_modify(options: Modify.ModifyOptions): this {
        Common.assertOptions(options, ['each', 'once', 'ref', 'schema'])
        return Modify.schema(this, options) || this
    }

    public $_mutateRebuild(): this {
        assert(!this._inRuleset(), 'Cannot add this rule inside a ruleset')
        this._refs.reset()
        this._ids.reset()
        const each = (item: unknown, {source, name, key}: Modify.ModifyEachSource): void => {
            const definitions: Record<string, { register?: number | false }> = this._definition[source]
            const family: number | false | undefined = definitions[name] && definitions[name].register
            if (family !== false) this.$_mutateRegister(item, {family, key})
        }
        this.$_modify({each})
        if (this._definition.rebuild) this._definition.rebuild(this)
        this.$_temp.ruleset = false
        return this
    }

    public $_mutateRegister(schema: unknown, {family, key}: { family?: number, key?: string | false } = {}): void {
        this._refs.register(schema, family)
        this._ids.register(schema, {key: key || undefined})
    }

    public $_property(name: string): unknown {
        return this._definition.properties[name]
    }

    public $_reach(path: string[]): SchemaInternals {
        return this._ids.reach(path)
    }

    public $_rootReferences(): PathKey[] {
        return this._refs.roots()
    }

    public $_setFlag(name: string, value: unknown, options: { clone?: boolean } = {}): this {
        assert(name[0] === '_' || !this._inRuleset(), 'Cannot set flag inside a ruleset')
        const flag: Extend.FlagDefinition = this._definition.flags[name] || {}
        if (deepEqual(value, flag.default)) value = undefined
        if (deepEqual(value, this._flags[name])) return this
        const obj: this = options.clone !== false ? this.clone() : this
        if (value !== undefined) {
            obj._flags[name] = value
            obj.$_mutateRegister(value)
        } else {
            delete obj._flags[name]
        }
        if (name[0] !== '_') obj.$_temp.ruleset = false
        return obj
    }

    public $_parent(method: string, ...args: unknown[]): unknown {
        const overridden: SchemaMethod & Record<symbol, SchemaMethod> = (this as unknown as Record<string, SchemaMethod & Record<symbol, SchemaMethod>>)[method]
        return overridden[Common.symbols.parent].call(this, ...args)
    }

    public $_validate(value: unknown, state: State, prefs: Preferences): Validator.SchemaResult {
        return Validator.validate(value, this, state, prefs)
    }

    //Internals

    public _assign<T extends SchemaInternals>(target: T): T {
        const assigned: Base = target as unknown as Base
        assigned.type = this.type
        assigned.$_root = this.$_root
        assigned.$_temp = Object.assign({}, this.$_temp)
        assigned.$_temp.whens = {}
        assigned._ids = this._ids.clone()
        assigned._preferences = this._preferences
        assigned._valids = this._valids && this._valids.clone()
        assigned._invalids = this._invalids && this._invalids.clone()
        assigned._rules = this._rules.slice()
        assigned._singleRules = clone(this._singleRules, {shallow: true})
        assigned._refs = this._refs.clone()
        assigned._flags = Object.assign({}, this._flags)
        assigned._cache = null
        assigned.$_terms = {}
        for (const key in this.$_terms) assigned.$_terms[key] = this.$_terms[key] ? (this.$_terms[key] as TermCollection).slice() : null
        //Backwards compatibility
        assigned.$_super = {}
        for (const override in this.$_super) assigned.$_super[override] = this._super[override].bind(assigned)
        return target
    }

    public _bare(): this {
        const obj: this = this.clone()
        obj._reset()
        const terms: Record<string, Extend.TermDefinition> = obj._definition.terms
        for (const name in terms) {
            const term: Extend.TermDefinition = terms[name]
            obj.$_terms[name] = term.init
        }
        return obj.$_mutateRebuild()
    }

    public _default(flag: 'default' | 'failover', value: unknown, options: DefaultOptions = {}): this {
        Common.assertOptions(options, 'literal')
        assert(value !== undefined, 'Missing', flag, 'value')
        assert(typeof value === 'function' || !options.literal, 'Only function value supports literal option')
        if (typeof value === 'function' && options.literal) {
            value = {
                [Common.symbols.literal]: true,
                literal: value
            }
        }
        const obj: this = this.$_setFlag(flag, value)
        return obj
    }

    public _generate(value: unknown, state: State, prefs: Preferences): { schema: Base, id?: string } {
        if (!this.$_terms.whens) return {schema: this}
        //Collect matching whens
        const whens: Base[] = []
        const ids: string[] = []
        const terms: WhenTerm[] = this.$_terms.whens as WhenTerm[]
        for (let i: number = 0; i < terms.length; ++i) {
            const when: WhenTerm = terms[i]
            if (when.concat) {
                whens.push(when.concat)
                ids.push(`${i}.concat`)
                continue
            }
            const input: unknown = when.ref ? when.ref.resolve(value, state, prefs, undefined) : value
            const tests: (WhenTerm | Compile.WhenCase)[] = when.is ? [when] : when.switch as Compile.WhenCase[]
            const before: number = ids.length
            for (let j: number = 0; j < tests.length; ++j) {
                const {is, then, otherwise} = tests[j] as { is: Base, then?: Base, otherwise?: Base }
                const baseId: string = `${i}${when.switch ? '.' + j : ''}`
                if (is.$_match(input, state.nest(is, `${baseId}.is`), prefs)) {
                    if (then) {
                        const localState: State = state.localize([...state.path, `${baseId}.then`], state.ancestors, state.schemas)
                        const {schema: generated, id} = then._generate(value, localState, prefs)
                        whens.push(generated)
                        ids.push(`${baseId}.then${id ? `(${id})` : ''}`)
                        break
                    }
                } else if (otherwise) {
                    const localState: State = state.localize([...state.path, `${baseId}.otherwise`], state.ancestors, state.schemas)
                    const {schema: generated, id} = otherwise._generate(value, localState, prefs)
                    whens.push(generated)
                    ids.push(`${baseId}.otherwise${id ? `(${id})` : ''}`)
                    break
                }
            }
            //Something matched
            if (when.break && ids.length > before) break
        }
        //Check cache
        const id: string = ids.join(', ')
        state.mainstay.tracer.debug(state, 'rule', 'when', id)
        if (!id) return {schema: this}
        if (!state.mainstay.tracer.active && this.$_temp.whens[id]) return {schema: this.$_temp.whens[id] as Base, id}
        //Generate dynamic schema
        let obj: Base = this
        if (this._definition.generate) obj = this._definition.generate(this, value, state, prefs) as Base
        //Apply whens
        for (const when of whens) obj = obj.concat(when)
        //Tracing
        if (this.$_root._tracer) this.$_root._tracer._combine(obj, [this, ...whens])
        //Cache result
        this.$_temp.whens[id] = obj
        return {schema: obj, id}
    }

    public _inner(type: string, values: unknown, options: InnerOptions = {}): this {
        assert(!this._inRuleset(), `Cannot set ${type} inside a ruleset`)
        const obj: this = this.clone()
        if (!obj.$_terms[type] || options.override) obj.$_terms[type] = []
        const term: unknown[] = obj.$_terms[type] as unknown[]
        if (options.single) {
            term.push(values)
        } else {
            term.push(...values as unknown[])
        }
        obj.$_temp.ruleset = false
        return obj
    }

    public _inRuleset(): boolean {
        return this.$_temp.ruleset !== null && this.$_temp.ruleset !== false
    }

    public _ruleRemove(name: string, options: { clone?: boolean } = {}): this {
        if (!this._singleRules.has(name)) return this
        const obj: this = options.clone !== false ? this.clone() : this
        obj._singleRules.delete(name)
        const filtered: SchemaRule[] = []
        for (let i: number = 0; i < obj._rules.length; ++i) {
            const test: SchemaRule = obj._rules[i]
            if (test.name === name && !test.keep) {
                if (obj._inRuleset() && i < (obj.$_temp.ruleset as number)) --(obj.$_temp.ruleset as number)
                continue
            }
            filtered.push(test)
        }
        obj._rules = filtered
        return obj
    }

    public _values(values: unknown[], key: '_valids' | '_invalids'): this {
        Common.verifyFlat(values, key.slice(1, -1))
        const obj: this = this.clone()
        const override: boolean = values[0] === Common.symbols.override
        if (override) values = values.slice(1)
        if (!obj[key] && values.length) {
            obj[key] = new Values()
        } else if (override) {
            obj[key] = values.length ? new Values() : null
            obj.$_mutateRebuild()
        }
        if (!obj[key]) return obj
        const set: Values = obj[key] as Values
        if (override) set.override()
        for (const value of values) {
            assert(value !== undefined, 'Cannot call allow/valid/invalid with undefined')
            assert(value !== Common.symbols.override, 'Override must be the first value')
            const other: '_valids' | '_invalids' = key === '_invalids' ? '_valids' : '_invalids'
            const otherSet: Values | null = obj[other]
            if (otherSet) {
                otherSet.remove(value)
                if (!otherSet.length) {
                    assert(key === '_valids' || !obj._flags.only, 'Setting invalid value', value, 'leaves schema rejecting all values due to previous valid rule')
                    obj[other] = null
                }
            }
            set.add(value, obj._refs)
        }
        return obj
    }

    //Standard Schema

    public get '~standard'(): StandardSchema {
        const mapToStandardError = (error: unknown): { issues: StandardIssue[] } => {
            let issues: StandardIssue[]
            if (Errors.ValidationError.isError(error)) {
                issues = error.details.map(({message, path}: { message: string, path: PathKey[] }): StandardIssue => ({
                    message,
                    path
                }))
            } else {
                issues = [{
                    message: (error as Error).message
                }]
            }
            return {
                issues
            }
        }
        const mapToStandardValue = (value: unknown): { value: unknown } => ({value})
        return {
            version: 1,
            vendor: 'joi',
            validate: (value: unknown): StandardResult | Promise<StandardResult> => {
                const result: Validator.ValidationResult | Promise<unknown> = Validator.standard(value, this)
                if (result instanceof Promise) return result.then(mapToStandardValue, mapToStandardError)
                if (!result.error) return mapToStandardValue(result.value)
                return mapToStandardError(result.error)
            }
        }
    }
}

Object.defineProperty(Base.prototype, Common.symbols.any, {
    value: {
        version: Common.version,
        compile: Compile.compile,
        root: '$_root'
    },
    writable: true,
    enumerable: true,
    configurable: true
})

//Prevents Hoek from deep cloning schema objects (must be on prototype)
Object.defineProperty(Base.prototype, 'isImmutable', {value: true, writable: true, enumerable: true, configurable: true})

//Aliases

for (const [alias, method] of [
    ['deny', 'invalid'],
    ['disallow', 'invalid'],
    ['equal', 'valid'],
    ['exist', 'required'],
    ['not', 'invalid'],
    ['options', 'prefs'],
    ['preferences', 'prefs']
] as const) {
    Object.defineProperty(Base.prototype, alias, {value: Base.prototype[method], writable: true, enumerable: true, configurable: true})
}

const base: Base = new Base()

export default base
