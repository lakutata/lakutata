/**
 * Derived from joi 18.0.2 lib/index.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, clone} from '../hoek/index.js'
import type {Base} from './base.js'
import * as Cache from './cache.js'
import * as Common from './common.js'
import * as Compile from './compile.js'
import * as Errors from './errors.js'
import * as Extend from './extend.js'
import type {LazySchemas} from './lazy.js'
import * as Manifest from './manifest.js'
import type {Preferences, RootLike} from './model.js'
import * as Ref from './ref.js'
import {Template, type TemplateOptions} from './template.js'
import * as Trace from './trace.js'
import Alternatives, {type AlternativesSchema} from './types/alternatives.js'
import Any, {type AnySchema} from './types/any.js'
import ArrayType, {type ArraySchema} from './types/array.js'
import BooleanType, {type BooleanSchema} from './types/boolean.js'
import DateType, {type DateSchema} from './types/date.js'
import FunctionType, {type FunctionSchema} from './types/function.js'
import Link, {type LinkSchema} from './types/link.js'
import NumberType, {type NumberSchema} from './types/number.js'
import ObjectType, {type ObjectSchema} from './types/object.js'
import StringType, {type StringSchema} from './types/string.js'
import SymbolType, {type SymbolSchema} from './types/symbol.js'
import BinaryType, {type BinarySchema} from './types/binary.js'
import getSchemas from './schemas.js'

let Schemas: LazySchemas | undefined

/**
 * A type factory of the root object
 */
export type TypeFactory<S extends Base = Base> = (this: Root, ...args: never[]) => S

/**
 * An extension: a type definition, extending a base schema (or any())
 * or all the types matching a pattern, or a function of the root returning one
 */
export interface Extension<S extends Base = Base> extends Omit<Extend.TypeDefinition<S>, 'type'> {
    type: string | RegExp
}

export type ExtensionFactory = (joi: Root) => Extension

/**
 * The root object (Joi): the type factories, their shortcuts and the helpers
 */
export interface Root extends RootLike {
    _types: Set<string>
    //Types
    alternatives(...schemas: unknown[]): AlternativesSchema
    any(): AnySchema
    array(): ArraySchema
    boolean(): BooleanSchema
    date(): DateSchema
    function(): FunctionSchema
    link(ref?: unknown): LinkSchema
    number(): NumberSchema
    object(schema?: Record<string, unknown> | null): ObjectSchema
    string(): StringSchema
    symbol(): SymbolSchema
    binary(): BinarySchema
    //Aliases
    alt(...schemas: unknown[]): AlternativesSchema
    bool(): BooleanSchema
    func(): FunctionSchema
    //Shortcuts (any() methods)
    allow(...values: unknown[]): AnySchema
    custom(method: Function, description?: string): AnySchema
    disallow(...values: unknown[]): AnySchema
    equal(...values: unknown[]): AnySchema
    exist(): AnySchema
    forbidden(): AnySchema
    invalid(...values: unknown[]): AnySchema
    not(...values: unknown[]): AnySchema
    only(mode?: boolean): AnySchema
    optional(): AnySchema
    options(prefs: Preferences): AnySchema
    prefs(prefs: Preferences): AnySchema
    preferences(prefs: Preferences): AnySchema
    required(): AnySchema
    strip(enabled?: boolean): AnySchema
    valid(...values: unknown[]): AnySchema
    when(condition: unknown, options?: Compile.WhenOptions | Compile.WhenSwitchCase[]): AnySchema
    //Methods
    ValidationError: typeof Errors.ValidationError
    version: string
    cache: typeof Cache.provider
    assert(value: unknown, schema: unknown, ...args: unknown[]): void
    attempt(value: unknown, schema: unknown, ...args: unknown[]): unknown
    build(desc: Manifest.SchemaDescription): Base
    checkPreferences(prefs: Preferences): void
    compile(schema: unknown, options?: Compile.CompileOptions): Base
    defaults(modifier: (schema: Base) => Base): Root
    expression(source: string, options?: TemplateOptions): Template
    x(source: string, options?: TemplateOptions): Template
    extend(...extensions: (Extension | ExtensionFactory)[]): Root
    isError(err: unknown): err is Errors.ValidationError
    isExpression(template: unknown): template is Template
    isRef(ref: unknown): ref is Ref.Ref
    isSchema(schema: unknown, options?: { legacy?: boolean }): boolean
    in(key: string, options?: Ref.RefOptions): Ref.Ref
    ref(key: string, options?: Ref.RefOptions): Ref.Ref
    types(): Record<string, Base>
    //Extension types
    [type: string]: unknown
}

/**
 * The root methods, called with the root object
 */
type Methods = Pick<Root, 'ValidationError' | 'version' | 'cache' | 'assert' | 'attempt' | 'build' | 'checkPreferences' | 'compile' | 'defaults' | 'expression' | 'extend' | 'isError' | 'isExpression' | 'isRef' | 'isSchema' | 'in' | 'override' | 'ref' | 'types'>

/**
 * A schema method called by a shortcut of the root object
 */
type SchemaMethod = (this: Base, ...args: unknown[]) => Base

const types: Record<string, Base> = {
    alternatives: Alternatives,
    any: Any,
    array: ArrayType,
    boolean: BooleanType,
    date: DateType,
    function: FunctionType,
    link: Link,
    number: NumberType,
    object: ObjectType,
    string: StringType,
    symbol: SymbolType
}

const aliases: Record<string, string> = {
    alt: 'alternatives',
    bool: 'boolean',
    func: 'function'
}

if (Buffer) types.binary = BinaryType

function createRoot(): Root {
    const root: Record<string, unknown> = {
        _types: new Set(Object.keys(types))
    }
    //Types
    for (const type of root._types as Set<string>) {
        root[type] = function (this: Root, ...args: unknown[]): Base {
            assert(!args.length || ['alternatives', 'link', 'object'].includes(type), 'The', type, 'type does not allow arguments')
            return generate(this, types[type], args)
        }
    }
    //Shortcuts
    for (const method of ['allow', 'custom', 'disallow', 'equal', 'exist', 'forbidden', 'invalid', 'not', 'only', 'optional', 'options', 'prefs', 'preferences', 'required', 'strip', 'valid', 'when']) {
        root[method] = function (this: Root, ...args: unknown[]): Base {
            const schema: AnySchema = this.any()
            return ((schema as unknown as Record<string, SchemaMethod>)[method]).call(schema, ...args)
        }
    }
    //Methods
    Object.assign(root, methods)
    //Aliases
    for (const alias in aliases) {
        const target: string = aliases[alias]
        root[alias] = root[target]
    }
    root.x = root.expression
    //Trace
    if (Trace.setup) Trace.setup(root as Trace.TraceRoot)
    return root as unknown as Root
}

const methods: Methods = {

    ValidationError: Errors.ValidationError,
    version: Common.version,
    cache: Cache.provider,

    assert(value: unknown, schema: unknown, ...args: unknown[]): void {
        //[message], [options]
        assertValue(value, schema as Base, true, args)
    },

    attempt(value: unknown, schema: unknown, ...args: unknown[]): unknown {
        //[message], [options]
        return assertValue(value, schema as Base, false, args)
    },

    build(this: Root, desc: Manifest.SchemaDescription): Base {
        assert(typeof Manifest.build === 'function', 'Manifest functionality disabled')
        return Manifest.build(this, desc)
    },

    checkPreferences(prefs: Preferences): void {
        Common.checkPreferences(prefs)
    },

    compile(this: Root, schema: unknown, options?: Compile.CompileOptions): Base {
        return Compile.compile(this, schema, options)
    },

    defaults(this: Root, modifier: (schema: Base) => Base): Root {
        assert(typeof modifier === 'function', 'modifier must be a function')
        const joi: Root = Object.assign({}, this)
        for (const type of joi._types) {
            const schema: Base = modifier((joi[type] as TypeFactory).call(joi))
            assert(Common.isSchema(schema), 'modifier must return a valid schema object')
            joi[type] = function (this: Root, ...args: unknown[]): Base {
                return generate(this, schema, args)
            }
        }
        return joi
    },

    expression(source: string, options?: TemplateOptions): Template {
        return new Template(source, options)
    },

    extend(this: Root, ...extensions: (Extension | ExtensionFactory)[]): Root {
        Common.verifyFlat(extensions, 'extend')
        Schemas = Schemas || getSchemas()
        assert(extensions.length, 'You need to provide at least one extension')
        this.assert(extensions, Schemas.extensions)
        const joi: Root = Object.assign({}, this)
        joi._types = new Set(joi._types)
        for (let extension of extensions) {
            if (typeof extension === 'function') extension = extension(joi)
            this.assert(extension, Schemas.extension)
            const expanded: Extend.TypeDefinition[] = expandExtension(extension, joi)
            for (const item of expanded) {
                assert(joi[item.type] === undefined || joi._types.has(item.type), 'Cannot override name', item.type)
                const base: Base = item.base || this.any()
                const schema: Base = Extend.type(base, item)
                joi._types.add(item.type)
                joi[item.type] = function (this: Root, ...args: unknown[]): Base {
                    return generate(this, schema, args)
                }
            }
        }
        return joi
    },

    isError: Errors.ValidationError.isError,
    isExpression: Template.isTemplate,
    isRef: Ref.isRef,
    isSchema: Common.isSchema,

    in(key: string, options?: Ref.RefOptions): Ref.Ref {
        return Ref.in(key, options)
    },

    override: Common.symbols.override,

    ref(key: string, options?: Ref.RefOptions): Ref.Ref {
        return Ref.create(key, options)
    },

    types(this: Root): Record<string, Base> {
        const result: Record<string, Base> = {}
        for (const type of this._types) result[type] = (this[type] as TypeFactory).call(this)
        for (const target in aliases) result[target] = (this[target] as TypeFactory).call(this)
        return result
    }
}

//Helpers

/**
 * An error thrown by assert() or attempt(): the validation error, or a copy of the override error
 */
type AssertedError = Error & { annotate?: (stripColorCodes?: boolean) => string }

function assertValue(value: unknown, schema: Base, annotate: boolean, args: unknown[]): unknown {
    //[message], [options]
    const message: Error | string | null = args[0] instanceof Error || typeof args[0] === 'string' ? args[0] : null
    const options: unknown = message !== null ? args[1] : args[0]
    const result: { value: unknown, error?: Error } = schema.validate(value, Common.preferences({errors: {stack: true}}, options as Preferences || {}))
    let error: AssertedError | undefined = result.error
    if (!error) return result.value
    if (message instanceof Error) throw message
    const display: string = annotate && typeof error.annotate === 'function' ? error.annotate() : error.message
    if (error instanceof Errors.ValidationError === false) error = clone(error)
    error.message = message ? `${message} ${display}` : display
    throw error
}

function generate(root: Root, schema: Base, args: unknown[]): Base {
    assert(root, 'Must be invoked on a Joi instance.')
    schema.$_root = root
    if (!schema._definition.args || !args.length) return schema
    return (schema._definition.args as (schema: Base, ...args: unknown[]) => Base)(schema, ...args)
}

function expandExtension(extension: Extension, joi: Root): Extend.TypeDefinition[] {
    if (typeof extension.type === 'string') return [extension as Extend.TypeDefinition]
    const extended: Extend.TypeDefinition[] = []
    for (const type of joi._types) {
        if (extension.type.test(type)) {
            const item: Extend.TypeDefinition = Object.assign({}, extension) as Extend.TypeDefinition
            item.type = type
            item.base = (joi[type] as TypeFactory).call(joi)
            extended.push(item)
        }
    }
    return extended
}

const Joi: Root = createRoot()

export default Joi
