/**
 * Derived from the upstream lib/manifest.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, clone} from '../hoek/index.js'
import * as Common from './common.js'
import type {Definition, RuleArgDefinition, TermManifest} from './extend.js'
import {Lazy, type LazySchemas} from './lazy.js'
import * as Messages from './messages.js'
import type {Preferences, RootLike, SchemaInternals} from './model.js'
import * as Ref from './ref.js'
import {Template, type TemplateDescription} from './template.js'

let Schemas: LazySchemas | undefined

/**
 * A described rule
 */
export interface RuleDescription {
    name: string
    args?: Record<string, unknown>
    [modifier: string]: unknown
}

/**
 * A schema description (see schema.describe()), terms included
 */
export interface SchemaDescription {
    type: string
    flags?: Record<string, unknown>
    preferences?: Preferences & { messages?: unknown }
    allow?: unknown[]
    invalid?: unknown[]
    rules?: RuleDescription[]
    whens?: unknown[]
    [term: string]: unknown
}

interface DescribeOptions {
    assign?: string
}

/**
 * A schema method called with the built description arguments
 */
type SchemaMethod = (...args: unknown[]) => SchemaInternals

/**
 * A schema, with its methods looked up by name
 */
type NamedMethods = Record<string, unknown>

/**
 * The root object, with the type factories looked up by name
 */
type BuilderRoot = RootLike & Record<string, unknown>

/**
 * Describe a schema
 * @param schema
 */
export function describe(schema: SchemaInternals): SchemaDescription {
    const def: Definition = schema._definition
    //Type
    const desc: SchemaDescription = {
        type: schema.type,
        flags: {},
        rules: []
    }
    const flags: Record<string, unknown> = desc.flags as Record<string, unknown>
    const rules: RuleDescription[] = desc.rules as RuleDescription[]
    //Flags
    for (const flag in schema._flags) {
        if (flag[0] !== '_') flags[flag] = describeItem(schema._flags[flag])
    }
    if (!Object.keys(flags).length) delete desc.flags
    //Preferences
    if (schema._preferences) {
        //The preferences may hold their merge with the default preferences (symbols.prefs)
        const preferences: NonNullable<SchemaDescription['preferences']> & Record<symbol, unknown> = clone(schema._preferences, {shallow: ['messages']}) as Preferences & Record<symbol, unknown>
        desc.preferences = preferences
        delete preferences[Common.symbols.prefs]
        if (preferences.messages) preferences.messages = Messages.decompile(preferences.messages as Parameters<typeof Messages.decompile>[0])
    }
    //Allow / Invalid
    if (schema._valids) desc.allow = schema._valids.describe()
    if (schema._invalids) desc.invalid = schema._invalids.describe()
    //Rules
    for (const rule of schema._rules) {
        const ruleDef: Definition['rules'][string] = def.rules[rule.name]
        //Defaults to true
        if (ruleDef.manifest === false) continue
        const item: RuleDescription = {name: rule.name}
        for (const custom in def.modifiers) {
            if (rule[custom] !== undefined) item[custom] = describeItem(rule[custom])
        }
        if (rule.args) {
            const args: Record<string, unknown> = {}
            item.args = args
            for (const key in rule.args) {
                const arg: unknown = rule.args[key]
                if (key === 'options' && !Object.keys(arg as object).length) continue
                args[key] = describeItem(arg, {assign: key})
            }
            if (!Object.keys(args).length) delete item.args
        }
        rules.push(item)
    }
    if (!rules.length) delete desc.rules
    //Terms (must be last to verify no name conflicts)
    for (const term in schema.$_terms) {
        if (term[0] === '_') continue
        assert(!desc[term], 'Cannot describe schema due to internal name conflict with', term)
        const items: unknown = schema.$_terms[term]
        if (!items) continue
        if (items instanceof Map) {
            if (items.size) desc[term] = [...items.entries()]
            continue
        }
        if (Common.isValues(items)) {
            desc[term] = (items as { describe(): unknown }).describe()
            continue
        }
        assert(def.terms[term], 'Term', term, 'missing configuration')
        const manifest: TermManifest | undefined = def.terms[term].manifest
        const mapped: boolean = typeof manifest === 'object'
        const list: unknown[] = items as unknown[]
        if (!list.length && !mapped) continue
        const normalized: unknown[] = []
        for (const item of list) normalized.push(describeItem(item))
        //Mapped
        if (mapped) {
            const {from, to} = (manifest as Exclude<TermManifest, string>).mapped
            const described: Record<string, unknown> = {}
            desc[term] = described
            for (const item of normalized) described[(item as Record<string, string>)[to]] = (item as Record<string, unknown>)[from]
            continue
        }
        //Single
        if (manifest === 'single') {
            assert(normalized.length === 1, 'Term', term, 'contains more than one item')
            desc[term] = normalized[0]
            continue
        }
        //Array
        desc[term] = normalized
    }
    validate(schema.$_root, desc)
    return desc
}

function describeItem(item: unknown, options: DescribeOptions = {}): unknown {
    //Like upstream (item.map(describe)), without options
    if (Array.isArray(item)) return item.map((entry: unknown): unknown => describeItem(entry))
    if (item === Common.symbols.deepDefault) return {special: 'deep'}
    if (typeof item !== 'object' || item === null) return item
    if (options.assign === 'options') return clone(item)
    if (Buffer && Buffer.isBuffer(item)) return {buffer: item.toString('binary')}
    if (item instanceof Date) return item.toISOString()
    if (item instanceof Error) return item
    if (item instanceof RegExp) {
        if (options.assign === 'regex') return item.toString()
        return {regex: item.toString()}
    }
    const record: Record<string | symbol, unknown> = item as Record<string | symbol, unknown>
    if (record[Common.symbols.literal]) return {function: record.literal}
    if (typeof record.describe === 'function') {
        const describer: () => unknown = record.describe as () => unknown
        if (options.assign === 'ref') return (describer.call(item) as { ref: unknown }).ref
        return describer.call(item)
    }
    const normalized: Record<string, unknown> = {}
    for (const key in record) {
        const value: unknown = record[key]
        if (value === undefined) continue
        normalized[key] = describeItem(value, {assign: key})
    }
    return normalized
}

/**
 * Build a schema from its description
 * @param engine
 * @param desc
 */
export function build(engine: RootLike, desc: SchemaDescription): SchemaInternals {
    const builder: Builder = new Builder(engine)
    return builder.parse(desc)
}

/**
 * Builds schemas and values from their descriptions
 */
export class Builder {

    public engine: BuilderRoot

    constructor(engine: RootLike) {
        this.engine = engine as BuilderRoot
    }

    public parse(desc: SchemaDescription): SchemaInternals {
        validate(this.engine, desc)
        //Type
        let schema: SchemaInternals = (this.engine[desc.type] as (this: BuilderRoot) => SchemaInternals).call(this.engine)._bare()
        const def: Definition = schema._definition
        //Flags
        if (desc.flags) {
            for (const flag in desc.flags) {
                const setter: string = def.flags[flag] && def.flags[flag].setter || flag
                assert(typeof (schema as unknown as NamedMethods)[setter] === 'function', 'Invalid flag', flag, 'for type', desc.type)
                schema = call(schema, setter, this.build(desc.flags[flag]))
            }
        }
        //Preferences
        if (desc.preferences) schema = schema.preferences(this.build(desc.preferences) as Preferences)
        //Allow / Invalid
        if (desc.allow) schema = schema.allow(...this.build(desc.allow) as unknown[])
        if (desc.invalid) schema = schema.invalid(...this.build(desc.invalid) as unknown[])
        //Rules
        if (desc.rules) {
            for (const rule of desc.rules) {
                assert(typeof (schema as unknown as NamedMethods)[rule.name] === 'function', 'Invalid rule', rule.name, 'for type', desc.type)
                const args: unknown[] = []
                if (rule.args) {
                    const built: Record<string, unknown> = {}
                    for (const key in rule.args) built[key] = this.build(rule.args[key], {assign: key})
                    const keys: string[] = Object.keys(built)
                    const definition: RuleArgDefinition[] | undefined = def.rules[rule.name].args
                    if (definition) {
                        assert(keys.length <= definition.length, 'Invalid number of arguments for', desc.type, rule.name, '(expected up to', definition.length, ', found', keys.length, ')')
                        for (const {name} of definition) args.push(built[name])
                    } else {
                        assert(keys.length === 1, 'Invalid number of arguments for', desc.type, rule.name, '(expected up to 1, found', keys.length, ')')
                        args.push(built[keys[0]])
                    }
                }
                //Apply
                schema = call(schema, rule.name, ...args)
                //Ruleset
                const options: Record<string, unknown> = {}
                for (const custom in def.modifiers) {
                    if (rule[custom] !== undefined) options[custom] = this.build(rule[custom])
                }
                if (Object.keys(options).length) schema = schema.rule(options)
            }
        }
        //Terms
        const terms: Record<string, unknown> = {}
        for (const key in desc) {
            if (['allow', 'flags', 'invalid', 'whens', 'preferences', 'rules', 'type'].includes(key)) continue
            assert(def.terms[key], 'Term', key, 'missing configuration')
            const manifest: TermManifest | undefined = def.terms[key].manifest
            if (manifest === 'schema') {
                terms[key] = (desc[key] as SchemaDescription[]).map((item: SchemaDescription): SchemaInternals => this.parse(item))
                continue
            }
            if (manifest === 'values') {
                terms[key] = (desc[key] as unknown[]).map((item: unknown): unknown => this.build(item))
                continue
            }
            if (manifest === 'single') {
                terms[key] = this.build(desc[key])
                continue
            }
            if (typeof manifest === 'object') {
                const mapped: Record<string, SchemaInternals> = {}
                terms[key] = mapped
                const described: Record<string, SchemaDescription> = desc[key] as Record<string, SchemaDescription>
                for (const name in described) {
                    const value: SchemaDescription = described[name]
                    mapped[name] = this.parse(value)
                }
                continue
            }
            terms[key] = this.build(desc[key])
        }
        if (desc.whens) terms.whens = desc.whens.map((when: unknown): unknown => this.build(when))
        schema = (def.manifest.build as NonNullable<Definition['manifest']['build']>)(schema, terms)
        schema.$_temp.ruleset = false
        return schema
    }

    public build(desc: unknown, options: DescribeOptions = {}): unknown {
        if (desc === null) return null
        if (Array.isArray(desc)) return desc.map((item: unknown): unknown => this.build(item))
        if (desc instanceof Error) return desc
        if (options.assign === 'options') return clone(desc)
        if (options.assign === 'regex') return regex(desc as string)
        if (options.assign === 'ref') return Ref.build(desc as Ref.RefDescription)
        if (typeof desc !== 'object') return desc
        const record: Record<string, unknown> = desc as Record<string, unknown>
        if (Object.keys(record).length === 1) {
            if (record.buffer) {
                assert(Buffer, 'Buffers are not supported')
                return Buffer && Buffer.from(record.buffer as string, 'binary')
            }
            if (record.function) return {[Common.symbols.literal]: true, literal: record.function}
            if (record.override) return Common.symbols.override
            if (record.ref) return Ref.build(record.ref as Ref.RefDescription)
            if (record.regex) return regex(record.regex as string)
            if (record.special) {
                assert(['deep'].includes(record.special as string), 'Unknown special value', record.special)
                return Common.symbols.deepDefault
            }
            if (record.value) return clone(record.value)
        }
        if (record.type) return this.parse(record as SchemaDescription)
        if (record.template) return Template.build(record as unknown as TemplateDescription)
        const normalized: Record<string, unknown> = {}
        for (const key in record) normalized[key] = this.build(record[key], {assign: key})
        return normalized
    }
}

function call(schema: SchemaInternals, name: string, ...args: unknown[]): SchemaInternals {
    return ((schema as unknown as NamedMethods)[name] as SchemaMethod).call(schema, ...args)
}

function regex(string: string): RegExp {
    const end: number = string.lastIndexOf('/')
    const exp: string = string.slice(1, end)
    const flags: string = string.slice(end + 1)
    return new RegExp(exp, flags)
}

function validate(engine: RootLike, desc: SchemaDescription): void {
    Schemas = Schemas || (Lazy.schemas as () => LazySchemas)()
    engine.assert(desc, Schemas.description)
}
