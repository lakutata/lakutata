/**
 * Derived from the upstream lib/extend.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone} from '../hoek/index.js'
import {assert} from './assert.js'
import * as Common from './common.js'
import * as Messages from './messages.js'
import type {Preferences, SchemaInternals, SchemaLike, SchemaRule, ValidationHelpers, ValidationOutcome} from './model.js'
import type {State} from './state.js'

/**
 * Any method, called with arguments checked by its own implementation
 */
export type DefinitionMethod<S> = (this: S, ...args: never[]) => unknown

/**
 * A type method run on the validated value (prepare, coerce, validate)
 */
export type TypeMethod<S extends SchemaInternals = SchemaInternals> = (value: unknown, helpers: ValidationHelpers<S>) => ValidationOutcome | undefined | void

/**
 * A rule validation: the validated value, errors, or a report
 */
export type RuleMethod<S extends SchemaInternals = SchemaInternals> = (value: unknown, helpers: ValidationHelpers<S>, args: Record<string, unknown>, rule: SchemaRule) => unknown

export interface FlagDefinition {
    default?: unknown
    setter?: string
    register?: number | false
}

/**
 * How a term is described: as schemas, as a single schema, as values, or mapped into objects
 */
export type TermManifest = 'schema' | 'single' | 'values' | { mapped: { from: string, to: string } }

export interface TermDefinition {
    init: unknown
    manifest?: TermManifest
    register?: number | false
}

export interface RuleArgDefinition {
    name: string
    ref?: boolean
    assert?: SchemaLike | ((value: unknown) => unknown)
    message?: string
    normalize?(value: unknown): unknown
}

export interface RuleDefinition<S extends SchemaInternals = SchemaInternals> {
    //undefined: a default method adding the rule, false: no method
    method?: DefinitionMethod<S> | false
    alias?: string | string[]
    args?: (string | RuleArgDefinition)[]
    //Set by extend() along with the normalized args
    argsByName?: Map<string, RuleArgDefinition>
    validate?: RuleMethod<S>
    convert?: boolean
    manifest?: boolean
    multi?: boolean
    priority?: boolean
    register?: number | false
}

/**
 * A rule definition, once extended
 */
export interface ExtendedRuleDefinition<S extends SchemaInternals = SchemaInternals> extends RuleDefinition<S> {
    args?: RuleArgDefinition[]
}

export type ModifierMethod = (rule: SchemaRule, value: unknown) => void

export interface CastDefinition<S extends SchemaInternals = SchemaInternals> {
    from(value: unknown): unknown
    to(value: unknown, helpers: ValidationHelpers<S>): unknown
}

export interface CoerceDefinition<S extends SchemaInternals = SchemaInternals> {
    method: TypeMethod<S>
    from?: string | string[] | null
}

export interface ManifestDefinition<S extends SchemaInternals = SchemaInternals> {
    build?(obj: S, desc: Record<string, unknown>): S
}

/**
 * The definition of a type, as provided to extend()
 */
export interface TypeDefinition<S extends SchemaInternals = SchemaInternals> {
    type: string
    base?: S
    args?(schema: S, ...args: never[]): S
    cast?: Record<string, CastDefinition<S>>
    coerce?: TypeMethod<S> | CoerceDefinition<S>
    flags?: Record<string, FlagDefinition>
    generate?(schema: S, value: unknown, state: State, prefs: Preferences): S | undefined
    manifest?: ManifestDefinition<S>
    messages?: Messages.MessagesInput
    modifiers?: Record<string, ModifierMethod>
    overrides?: Record<string, DefinitionMethod<S>>
    prepare?: TypeMethod<S>
    properties?: Record<string, unknown>
    rebuild?(schema: S): void
    rules?: Record<string, RuleDefinition<S>>
    terms?: Record<string, TermDefinition>
    validate?: TypeMethod<S>
}

/**
 * The definition of a type, once extended (merged with its parent's)
 */
export interface Definition<S extends SchemaInternals = SchemaInternals> {
    type: string
    args?(schema: S, ...args: never[]): S
    cast: Record<string, CastDefinition<S>>
    coerce?: CoerceDefinition<S> & { from?: string[] | null }
    flags: Record<string, FlagDefinition>
    generate?(schema: S, value: unknown, state: State, prefs: Preferences): S | undefined
    manifest: ManifestDefinition<S>
    messages: Messages.Messages | null | undefined
    modifiers: Record<string, ModifierMethod>
    overrides?: Record<string, DefinitionMethod<S>>
    prepare?: TypeMethod<S>
    properties: Record<string, unknown>
    rebuild?(schema: S): void
    rules: Record<string, ExtendedRuleDefinition<S>>
    terms: Record<string, TermDefinition>
    validate?: TypeMethod<S>
}

/**
 * A schema prototype, holding the type definition and the rule, modifier and override methods
 */
type SchemaPrototype<S extends SchemaInternals> = Record<string | symbol, unknown> & {
    _definition: Definition<S>
    _super?: SchemaPrototype<S>
}

/**
 * A new type (a schema with its own prototype), extending the type of a schema
 * @param from
 * @param options
 */
export function type<S extends SchemaInternals>(from: S, options: TypeDefinition<S>): S {
    const base: SchemaPrototype<S> = Object.getPrototypeOf(from)
    const prototype: SchemaPrototype<S> = clone(base)
    const schema: S & { $_super?: Record<string, Function> } = from._assign(Object.create(prototype) as S)
    //Shallow cloned
    const def: TypeDefinition<S> = Object.assign({}, options)
    delete def.base
    //Normalized in place below, like upstream
    const extended: Definition<S> = def as unknown as Definition<S>
    prototype._definition = extended
    const parent: Partial<Definition<S>> = base._definition || {}
    extended.messages = Messages.merge(parent.messages, def.messages as Messages.MessagesInput | undefined)
    extended.properties = Object.assign({}, parent.properties, def.properties)
    //Type
    schema.type = def.type
    //Flags
    extended.flags = Object.assign({}, parent.flags, def.flags)
    //Terms
    const terms: Record<string, TermDefinition> = Object.assign({}, parent.terms)
    if (def.terms) {
        //Only apply own terms
        for (const name in def.terms) {
            const term: TermDefinition = def.terms[name]
            assert(schema.$_terms[name] === undefined, 'Invalid term override for', def.type, name)
            schema.$_terms[name] = term.init
            terms[name] = term
        }
    }
    extended.terms = terms
    //Constructor arguments
    if (!def.args) extended.args = parent.args
    //Prepare
    extended.prepare = prepare(def.prepare, parent.prepare)
    //Coerce
    if (def.coerce) {
        if (typeof def.coerce === 'function') def.coerce = {method: def.coerce}
        if (def.coerce.from && !Array.isArray(def.coerce.from)) def.coerce = {method: def.coerce.method, from: ([] as string[]).concat(def.coerce.from)}
    }
    extended.coerce = coerce(def.coerce as Definition<S>['coerce'], parent.coerce)
    //Validate
    extended.validate = validate(def.validate, parent.validate)
    //Rules
    const rules: Record<string, ExtendedRuleDefinition<S>> = Object.assign({}, parent.rules)
    if (def.rules) {
        for (const name in def.rules) {
            const rule: RuleDefinition<S> = def.rules[name]
            assert(typeof rule === 'object', 'Invalid rule definition for', def.type, name)
            let method: DefinitionMethod<S> | false | undefined = rule.method
            if (method === undefined) {
                method = function (this: S): S {
                    return this.$_addRule(name)
                }
            }
            if (method) {
                assert(!prototype[name], 'Rule conflict in', def.type, name)
                prototype[name] = method
            }
            assert(!rules[name], 'Rule conflict in', def.type, name)
            rules[name] = rule as ExtendedRuleDefinition<S>
            if (rule.alias) {
                const aliases: string[] = ([] as string[]).concat(rule.alias)
                for (const alias of aliases) prototype[alias] = rule.method
            }
            if (rule.args) {
                const argsByName: Map<string, RuleArgDefinition> = new Map()
                rule.argsByName = argsByName
                rule.args = rule.args.map((arg: string | RuleArgDefinition): RuleArgDefinition => {
                    if (typeof arg === 'string') arg = {name: arg}
                    assert(!argsByName.has(arg.name), 'Duplicated argument name', arg.name)
                    if (Common.isSchema(arg.assert)) arg.assert = (arg.assert as SchemaInternals).strict().label(arg.name)
                    argsByName.set(arg.name, arg)
                    return arg
                })
            }
        }
    }
    extended.rules = rules
    //Modifiers
    const modifiers: Record<string, ModifierMethod> = Object.assign({}, parent.modifiers)
    if (def.modifiers) {
        for (const name in def.modifiers) {
            assert(!prototype[name], 'Rule conflict in', def.type, name)
            const modifier: ModifierMethod = def.modifiers[name]
            assert(typeof modifier === 'function', 'Invalid modifier definition for', def.type, name)
            const method = function (this: S, arg: unknown): S {
                return this.rule({[name]: arg})
            }
            prototype[name] = method
            modifiers[name] = modifier
        }
    }
    extended.modifiers = modifiers
    //Overrides
    if (def.overrides) {
        prototype._super = base
        //Backwards compatibility
        schema.$_super = {}
        for (const override in def.overrides) {
            const overridden: Function = base[override] as Function
            assert(overridden, 'Cannot override missing', override)
            ;(def.overrides[override] as DefinitionMethod<S> & Record<symbol, unknown>)[Common.symbols.parent] = overridden
            //Backwards compatibility
            schema.$_super[override] = overridden.bind(schema)
        }
        Object.assign(prototype, def.overrides)
    }
    //Casts
    extended.cast = Object.assign({}, parent.cast, def.cast)
    //Manifest
    const manifest: ManifestDefinition<S> = Object.assign({}, parent.manifest, def.manifest)
    manifest.build = build(def.manifest && def.manifest.build, parent.manifest && parent.manifest.build)
    extended.manifest = manifest
    //Rebuild
    extended.rebuild = rebuild(def.rebuild, parent.rebuild)
    return schema
}

//Helpers

type BuildMethod<S> = (obj: S, desc: Record<string, unknown>) => S

function build<S>(child: BuildMethod<S> | undefined, parent: BuildMethod<S> | undefined): BuildMethod<S> | undefined {
    if (!child || !parent) return child || parent
    return function (obj: S, desc: Record<string, unknown>): S {
        return parent(child(obj, desc), desc)
    }
}

type ExtendedCoerce<S extends SchemaInternals> = NonNullable<Definition<S>['coerce']>

function coerce<S extends SchemaInternals>(child: ExtendedCoerce<S> | undefined, parent: ExtendedCoerce<S> | undefined): ExtendedCoerce<S> | undefined {
    if (!child || !parent) return child || parent
    return {
        from: child.from && parent.from ? [...new Set([...child.from, ...parent.from])] : null,
        method(value: unknown, helpers: ValidationHelpers<S>): ValidationOutcome | undefined | void {
            let coerced: ValidationOutcome | undefined | void
            if (!parent.from || parent.from.includes(typeof value)) {
                coerced = parent.method(value, helpers)
                if (coerced) {
                    if (coerced.errors || coerced.value === undefined) return coerced
                    value = coerced.value
                }
            }
            if (!child.from || child.from.includes(typeof value)) {
                const own: ValidationOutcome | undefined | void = child.method(value, helpers)
                if (own) return own
            }
            return coerced
        }
    }
}

function prepare<S extends SchemaInternals>(child: TypeMethod<S> | undefined, parent: TypeMethod<S> | undefined): TypeMethod<S> | undefined {
    if (!child || !parent) return child || parent
    return function (value: unknown, helpers: ValidationHelpers<S>): ValidationOutcome | undefined | void {
        const prepared: ValidationOutcome | undefined | void = child(value, helpers)
        if (prepared) {
            if (prepared.errors || prepared.value === undefined) return prepared
            value = prepared.value
        }
        return parent(value, helpers) || prepared
    }
}

function rebuild<S>(child: ((schema: S) => void) | undefined, parent: ((schema: S) => void) | undefined): ((schema: S) => void) | undefined {
    if (!child || !parent) return child || parent
    return function (schema: S): void {
        parent(schema)
        child(schema)
    }
}

function validate<S extends SchemaInternals>(child: TypeMethod<S> | undefined, parent: TypeMethod<S> | undefined): TypeMethod<S> | undefined {
    if (!child || !parent) return child || parent
    return function (value: unknown, helpers: ValidationHelpers<S>): ValidationOutcome | undefined | void {
        const result: ValidationOutcome | undefined | void = parent(value, helpers)
        if (result) {
            if (result.errors && (!Array.isArray(result.errors) || result.errors.length)) return result
            value = result.value
        }
        return child(value, helpers) || result
    }
}
