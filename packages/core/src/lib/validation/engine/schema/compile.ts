/**
 * Derived from joi 18.0.2 lib/compile.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../hoek/index.js'
import * as Common from './common.js'
import type {PathError, RootLike, SchemaInternals} from './model.js'
import * as Ref from './ref.js'

export interface SchemaOptions {
    appendPath?: boolean
    override?: boolean
}

export interface CompileOptions {
    legacy?: boolean
}

/**
 * The marker of a compiled schema (schema[Common.symbols.any]), shared by the supported versions
 */
interface AnyMarker {
    version: string
    root: string
    compile(root: unknown, schema: unknown): SchemaInternals
}

interface Compiler {
    root: unknown
    compile(root: unknown, schema: unknown): SchemaInternals
}

/**
 * A when() switch case, as provided
 */
export interface WhenSwitchCase {
    is?: unknown
    then?: unknown
    otherwise?: unknown
}

/**
 * The when() options, as provided
 */
export interface WhenOptions {
    is?: unknown
    not?: unknown
    then?: unknown
    otherwise?: unknown
    switch?: WhenSwitchCase[]
    break?: boolean
}

/**
 * A compiled single when() condition
 */
export interface WhenCondition {
    ref?: Ref.Ref
    is: SchemaInternals
    then?: SchemaInternals
    otherwise?: SchemaInternals
    break?: boolean
}

/**
 * A compiled when() switch case
 */
export interface WhenCase {
    is: SchemaInternals
    then: SchemaInternals
    otherwise?: SchemaInternals
}

/**
 * A compiled when() switch statement
 */
export interface WhenSwitch {
    ref: Ref.Ref
    switch: WhenCase[]
    break?: boolean
}

type ConditionInput = { ref?: Ref.Ref, is: SchemaInternals, then?: unknown, otherwise?: unknown, break?: boolean }

/**
 * Compile a schema description (literals, arrays, objects, regular expressions...) into a schema
 * @param root
 * @param config
 * @param options
 */
export function schema(root: RootLike, config: unknown, options: SchemaOptions = {}): SchemaInternals {
    Common.assertOptions(options, ['appendPath', 'override'])
    try {
        return compileSchema(root, config, options)
    } catch (err) {
        if (options.appendPath && (err as PathError).path !== undefined) (err as PathError).message = `${(err as PathError).message} (${(err as PathError).path})`
        throw err
    }
}

function compileSchema(root: RootLike, config: unknown, options: SchemaOptions): SchemaInternals {
    assert(config !== undefined, 'Invalid undefined schema')
    if (Array.isArray(config)) {
        assert(config.length, 'Invalid empty array schema')
        if (config.length === 1) config = config[0]
    }
    const valid = (base: { valid(...values: unknown[]): SchemaInternals }, ...values: unknown[]): SchemaInternals => {
        if (options.override !== false) return base.valid(root.override, ...values)
        return base.valid(...values)
    }
    if (simple(config)) return valid(root, config)
    if (typeof config === 'function') return root.custom(config)
    assert(typeof config === 'object', 'Invalid schema content:', typeof config)
    if (Common.isResolvable(config)) return valid(root, config)
    if (Common.isSchema(config)) return config as SchemaInternals
    if (Array.isArray(config)) {
        for (const item of config) {
            if (!simple(item)) return root.alternatives().try(...config)
        }
        return valid(root, ...config)
    }
    if (config instanceof RegExp) return root.string().regex(config)
    if (config instanceof Date) return valid(root.date(), config)
    assert(Object.getPrototypeOf(config) === Object.getPrototypeOf({}), 'Schema can only contain plain objects')
    return root.object().keys(config)
}

/**
 * A reference, created from its key unless it is one already
 * @param id
 * @param options
 */
export function ref(id: unknown, options?: Ref.RefOptions): Ref.Ref {
    return Ref.isRef(id) ? id : Ref.create(id as string, options)
}

/**
 * Compile a schema, unless it is compiled already (by this version, or by a legacy one when allowed)
 * @param root
 * @param schema
 * @param options
 */
export function compile(root: RootLike, schema: unknown, options: CompileOptions = {}): SchemaInternals {
    Common.assertOptions(options, ['legacy'])
    //Compiled by any supported version
    const any: AnyMarker | undefined = schema ? (schema as Record<symbol, AnyMarker | undefined>)[Common.symbols.any] : undefined
    if (any) {
        assert(options.legacy || any.version === Common.version, 'Cannot mix different versions of validation schemas:', any.version, Common.version)
        return schema as SchemaInternals
    }
    //Uncompiled root
    //Will error if schema contains other versions
    if (typeof schema !== 'object' || !options.legacy) return compileRoot(root, schema)
    //Scan schema for compiled parts
    const compiler: Compiler | null = walk(schema)
    if (!compiler) return compileRoot(root, schema)
    return compiler.compile(compiler.root, schema)
}

function compileRoot(root: RootLike, config: unknown): SchemaInternals {
    return schema(root, config, {appendPath: true})
}

function walk(schema: unknown): Compiler | null {
    if (typeof schema !== 'object') return null
    if (Array.isArray(schema)) {
        for (const item of schema) {
            const compiler: Compiler | null = walk(item)
            if (compiler) return compiler
        }
        return null
    }
    //Like upstream: null (typeof 'object') throws on the symbol lookup
    const record: Record<string | symbol, unknown> = schema as Record<string | symbol, unknown>
    const any: AnyMarker | undefined = record[Common.symbols.any] as AnyMarker | undefined
    if (any) return {root: record[any.root], compile: any.compile}
    assert(Object.getPrototypeOf(schema) === Object.getPrototypeOf({}), 'Schema can only contain plain objects')
    for (const key in record) {
        const compiler: Compiler | null = walk(record[key])
        if (compiler) return compiler
    }
    return null
}

function simple(value: unknown): value is null | boolean | string | number {
    return value === null || ['boolean', 'string', 'number'].includes(typeof value)
}

/**
 * Compile when() arguments into a condition or a switch statement
 * @param schema
 * @param condition
 * @param options
 */
export function when(schema: SchemaInternals, condition: unknown, options?: WhenOptions | WhenSwitchCase[]): WhenCondition | WhenSwitch {
    if (options === undefined) {
        assert(condition && typeof condition === 'object', 'Missing options')
        options = condition as WhenOptions
        condition = Ref.create('.')
    }
    if (Array.isArray(options)) options = {switch: options}
    Common.assertOptions(options, ['is', 'not', 'then', 'otherwise', 'switch', 'break'])
    //Schema condition
    if (Common.isSchema(condition)) {
        assert(options.is === undefined, '"is" can not be used with a schema condition')
        assert(options.not === undefined, '"not" can not be used with a schema condition')
        assert(options.switch === undefined, '"switch" can not be used with a schema condition')
        return conditionOf(schema, {is: condition as SchemaInternals, then: options.then, otherwise: options.otherwise, break: options.break})
    }
    //Single condition
    assert(Ref.isRef(condition) || typeof condition === 'string', 'Invalid condition:', condition)
    assert(options.not === undefined || options.is === undefined, 'Cannot combine "is" with "not"')
    if (options.switch === undefined) {
        let rule: WhenOptions = options
        if (options.not !== undefined) rule = {is: options.not, then: options.otherwise, otherwise: options.then, break: options.break}
        let is: SchemaInternals = rule.is !== undefined ? schema.$_compile(rule.is) : schema.$_root.invalid(null, false, 0, '').required()
        assert(rule.then !== undefined || rule.otherwise !== undefined, 'options must have at least one of "then", "otherwise", or "switch"')
        assert(rule.break === undefined || rule.then === undefined || rule.otherwise === undefined, 'Cannot specify then, otherwise, and break all together')
        //Only apply required if this wasn't already a schema or a ref
        if (options.is !== undefined && !Ref.isRef(options.is) && !Common.isSchema(options.is)) is = is.required()
        return conditionOf(schema, {ref: ref(condition), is, then: rule.then, otherwise: rule.otherwise, break: rule.break})
    }
    //Switch statement
    assert(Array.isArray(options.switch), '"switch" must be an array')
    assert(options.is === undefined, 'Cannot combine "switch" with "is"')
    assert(options.not === undefined, 'Cannot combine "switch" with "not"')
    assert(options.then === undefined, 'Cannot combine "switch" with "then"')
    const rule: WhenSwitch = {
        ref: ref(condition),
        switch: [],
        break: options.break
    }
    for (let i: number = 0; i < options.switch.length; ++i) {
        const test: WhenSwitchCase = options.switch[i]
        const last: boolean = i === options.switch.length - 1
        Common.assertOptions(test, last ? ['is', 'then', 'otherwise'] : ['is', 'then'])
        assert(test.is !== undefined, 'Switch statement missing "is"')
        assert(test.then !== undefined, 'Switch statement missing "then"')
        const item: WhenCase = {
            is: schema.$_compile(test.is),
            then: schema.$_compile(test.then)
        }
        //Only apply required if this wasn't already a schema or a ref
        if (!Ref.isRef(test.is) && !Common.isSchema(test.is)) item.is = item.is.required()
        if (last) {
            assert(options.otherwise === undefined || test.otherwise === undefined, 'Cannot specify "otherwise" inside and outside a "switch"')
            const otherwise: unknown = options.otherwise !== undefined ? options.otherwise : test.otherwise
            if (otherwise !== undefined) {
                assert(rule.break === undefined, 'Cannot specify both otherwise and break')
                item.otherwise = schema.$_compile(otherwise)
            }
        }
        rule.switch.push(item)
    }
    return rule
}

function conditionOf(schema: SchemaInternals, condition: ConditionInput): WhenCondition {
    for (const key of ['then', 'otherwise'] as const) {
        if (condition[key] === undefined) {
            delete condition[key]
        } else {
            condition[key] = schema.$_compile(condition[key])
        }
    }
    return condition as WhenCondition
}
