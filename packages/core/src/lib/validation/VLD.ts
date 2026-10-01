import Engine from './engine/schema/index.js'
import type {Base} from './engine/schema/base.js'
import type {Preferences} from './engine/schema/model.js'
import type {ValidationResult as EngineValidationResult} from './engine/schema/validator.js'
import {extendBigInt} from './engine/schema/extensions/bigint.js'
import {AnySchema} from './interfaces/AnySchema.js'
import {ArraySchema} from './interfaces/ArraySchema.js'
import {BooleanSchema} from './interfaces/BooleanSchema.js'
import {BinarySchema} from './interfaces/BinarySchema.js'
import {DateSchema} from './interfaces/DateSchema.js'
import {FunctionSchema} from './interfaces/FunctionSchema.js'
import {NumberSchema} from './interfaces/NumberSchema.js'
import {ObjectSchema} from './interfaces/ObjectSchema.js'
import {StringSchema} from './interfaces/StringSchema.js'
import {SymbolSchema} from './interfaces/SymbolSchema.js'
import {AlternativesSchema} from './interfaces/AlternativesSchema.js'
import {LinkSchema} from './interfaces/LinkSchema.js'
import {Schema} from './types/Schema.js'
import {SchemaFunction} from './types/SchemaFunction.js'
import {ValidationOptions} from './interfaces/ValidationOptions.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {SchemaMap} from './types/SchemaMap.js'
import {SchemaLike} from './types/SchemaLike.js'
import {As} from '@lakutata/utils/helper/As'
import {CustomValidator} from './types/CustomValidator.js'
import {ReferenceOptions} from './interfaces/ReferenceOptions.js'
import {Reference} from './interfaces/Reference.js'
import {BigIntSchema} from './interfaces/BigIntSchema.js'
import {SchemaValidationException} from './exceptions/SchemaValidationException.js'
import {WithCause} from '../helpers/internal/WithCause.js'
import {CacheConfiguration} from './interfaces/CacheConfiguration.js'
import {CompileOptions} from './interfaces/CompileOptions.js'
import {Extension} from './interfaces/Extension.js'

/**
 * An extension created from the validation API
 */
export type ExtensionFactory = (vld: ValidateAPI) => Extension

export const DefaultValidationOptions: ValidationOptions = Object.freeze({
    abortEarly: true,
    cache: false,
    allowUnknown: true,
    stripUnknown: true,
    convert: true
})

/**
 * A node of the merged options cache: the merged options of the option path, and the next nodes by option name then value
 */
interface MergedOptionsNode {
    merged?: ValidationOptions
    next: Map<string, Map<unknown, MergedOptionsNode>>
}

let mergedOptionsRoot: MergedOptionsNode = {next: new Map()}

let mergedOptionsCount: number = 0

const maxMergedOptions: number = 1000

/**
 * The default options merged with the options. For options of primitive values, the merged options are frozen and
 * reused (the validation engine then reuses its settings and the schema preferences merged with them).
 * @param options
 */
function mergeOptions(options: ValidationOptions): ValidationOptions {
    if (Object.getOwnPropertySymbols(options).length) return {...DefaultValidationOptions, ...options}
    let node: MergedOptionsNode = mergedOptionsRoot
    for (const name of Object.keys(options)) {
        const value: unknown = (options as Record<string, unknown>)[name]
        //-0 is not kept apart from 0 by the maps
        if ((value !== null && typeof value === 'object') || typeof value === 'function' || Object.is(value, -0)) return {...DefaultValidationOptions, ...options}
        let byValue: Map<unknown, MergedOptionsNode> | undefined = node.next.get(name)
        if (!byValue) {
            byValue = new Map()
            node.next.set(name, byValue)
        }
        let child: MergedOptionsNode | undefined = byValue.get(value)
        if (!child) {
            child = {next: new Map()}
            byValue.set(value, child)
        }
        node = child
    }
    if (!node.merged) {
        if (mergedOptionsCount >= maxMergedOptions) {
            mergedOptionsRoot = {next: new Map()}
            mergedOptionsCount = 0
        }
        node.merged = Object.freeze({...DefaultValidationOptions, ...options})
        mergedOptionsCount++
    }
    return node.merged
}

export interface ValidateAPI {

    ValidationError: typeof SchemaValidationException;

    /**
     * Generates a schema object that matches any data type.
     */
    any<TSchema = any>(): AnySchema<TSchema>;

    /**
     * Generates a schema object that matches an array data type.
     */
    array<TSchema = any[]>(): ArraySchema<TSchema>;

    /**
     * Generates a schema object that matches a boolean data type (as well as the strings 'true', 'false', 'yes', and 'no'). Can also be called via boolean().
     */
    bool<TSchema = boolean>(): BooleanSchema<TSchema>;

    /**
     * Generates a schema object that matches a boolean data type (as well as the strings 'true', 'false', 'yes', and 'no'). Can also be called via bool().
     */
    boolean<TSchema = boolean>(): BooleanSchema<TSchema>;

    /**
     * Generates a schema object that matches a Buffer data type (as well as the strings which will be converted to Buffers).
     */
    binary<TSchema = Buffer>(): BinarySchema<TSchema>;

    /**
     * Generates a schema object that matches a date type (as well as a JavaScript date string or number of milliseconds).
     */
    date<TSchema = Date>(): DateSchema<TSchema>;

    /**
     * Generates a schema object that matches a function type.
     */
    func<TSchema = Function>(): FunctionSchema<TSchema>;

    /**
     * Generates a schema object that matches a function type.
     */
    function<TSchema = Function>(): FunctionSchema<TSchema>;

    /**
     * Generates a schema object that matches a number data type (as well as strings that can be converted to numbers).
     */
    number<TSchema = number>(): NumberSchema<TSchema>;

    /**
     * Generates a schema object that matches a bigint data type (as well as strings that can be converted to bigint).
     */
    bigint<TSchema = bigint>(): BigIntSchema<TSchema>

    /**
     * Generates a schema object that matches an object data type (as well as JSON strings that have been parsed into objects).
     */
    // tslint:disable-next-line:no-unnecessary-generics
    object<TSchema = any, isStrict = false, T = TSchema>(schema?: SchemaMap<T, isStrict>): ObjectSchema<TSchema>;

    /**
     * Generates a schema object that matches a string data type. Note that empty strings are not allowed by default and must be enabled with allow('').
     */
    string<TSchema = string>(): StringSchema<TSchema>;

    /**
     * Generates a schema object that matches any symbol.
     */
    symbol<TSchema = Symbol>(): SymbolSchema<TSchema>;

    /**
     * Generates a type that will match one of the provided alternative schemas
     */
    alternatives<TSchema = any>(types: SchemaLike[]): AlternativesSchema<TSchema>;

    alternatives<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema>;

    /**
     * Alias for `alternatives`
     */
    alt<TSchema = any>(types: SchemaLike[]): AlternativesSchema<TSchema>;

    alt<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema>;

    /**
     * Links to another schema node and reuses it for validation, typically for creative recursive schemas.
     *
     * @param ref - the reference to the linked schema node.
     * Cannot reference itself or its children as well as other links.
     * Links can be expressed in relative terms like value references (`VLD.link('...')`),
     * in absolute terms from the schema run-time root (`VLD.link('/a')`),
     * or using schema ids implicitly using object keys or explicitly using `any.id()` (`VLD.link('#a.b.c')`).
     */
    link<TSchema = any>(ref?: string): LinkSchema<TSchema>;

    /**
     * Validates a value against a schema and throws if validation fails.
     *
     * @param value - the value to validate.
     * @param schema - the schema object.
     * @param options
     */
    assert(value: any, schema: Schema, options?: ValidationOptions): void;

    /**
     * Validates a value against a schema and throws if validation fails.
     *
     * @param value - the value to validate.
     * @param schema - the schema object.
     * @param message - optional message string prefix added in front of the error message. may also be an Error object.
     * @param options
     */
    assert(value: any, schema: Schema, message: string | Error, options?: ValidationOptions): void;

    /**
     * Validates a value against a schema, returns valid object, and throws if validation fails.
     *
     * @param value - the value to validate.
     * @param schema - the schema object.
     * @param options
     */
    attempt<TSchema extends Schema>(value: any, schema: TSchema, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never;

    /**
     * Validates a value against a schema, returns valid object, and throws if validation fails.
     *
     * @param value - the value to validate.
     * @param schema - the schema object.
     * @param message - optional message string prefix added in front of the error message. may also be an Error object.
     * @param options
     */
    attempt<TSchema extends Schema>(value: any, schema: TSchema, message: string | Error, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never;

    cache: CacheConfiguration;

    /**
     * Converts literal schema definition to schema object (or returns the same back if already a schema object).
     */
    compile(schema: SchemaLike, options?: CompileOptions): Schema;

    /**
     * Checks if the provided preferences are valid.
     *
     * Throws an exception if the prefs object is invalid.
     *
     * The method is provided to perform inputs validation for the `any.validate()` and `any.validateAsync()` methods.
     * Validation is not performed automatically for performance reasons. Instead, manually validate the preferences passed once and reuse.
     */
    checkPreferences(prefs: ValidationOptions): void;

    /**
     * Creates a custom validation schema.
     */
    custom(fn: CustomValidator, description?: string): Schema;

    /**
     * Creates a new instance that will apply defaults onto newly created schemas
     * through the use of the fn function that takes exactly one argument, the schema being created.
     *
     * @param fn - The function must always return a schema, even if untransformed.
     */
    defaults(fn: SchemaFunction): ValidateAPI;

    /**
     * Generates a dynamic expression using a template string.
     */
    expression(template: string, options?: ReferenceOptions): any;

    /**
     * Creates a new instance customized with the extension(s) you provide included.
     */
    extend(...extensions: Array<Extension | ExtensionFactory>): any;

    /**
     * Creates a reference that when resolved, is used as an array of values to match against the rule.
     */
    in(ref: string, options?: ReferenceOptions): Reference;

    /**
     * Checks whether or not the provided argument is a SchemaValidationException
     */
    isError(error: any): error is SchemaValidationException;

    /**
     * Checks whether or not the provided argument is an expression.
     */
    isExpression(expression: any): boolean;

    /**
     * Checks whether or not the provided argument is a reference. It's especially useful if you want to post-process error messages.
     */
    isRef(ref: any): ref is Reference;

    /**
     * Checks whether or not the provided argument is a schema.
     */
    isSchema(schema: any, options?: CompileOptions): schema is AnySchema;

    /**
     * A special value used with `any.allow()`, `any.invalid()`, and `any.valid()` as the first value to reset any previously set values.
     */
    override: symbol;

    /**
     * Generates a reference to the value of the named key.
     */
    ref(key: string, options?: ReferenceOptions): Reference;

    /**
     * Returns an object where each key is a plain schema type.
     * Useful for creating type shortcuts using deconstruction.
     * Note that the types are already formed and do not need to be called as functions (e.g. `string`, not `string()`).
     */
    types(): {
        alternatives: AlternativesSchema;
        any: AnySchema;
        array: ArraySchema;
        binary: BinarySchema;
        boolean: BooleanSchema;
        date: DateSchema;
        function: FunctionSchema;
        link: LinkSchema;
        number: NumberSchema;
        object: ObjectSchema;
        string: StringSchema;
        symbol: SymbolSchema;
    };

    /**
     * Generates a dynamic expression using a template string.
     */
    x(template: string, options?: ReferenceOptions): any;
}

/**
 * The object schemas wrapping a schema under a target name, by schema then by name (schemas are immutable)
 */
const targetSchemas: WeakMap<object, Map<string | symbol, Base>> = new WeakMap()

/**
 * An object schema with the schema under the target name, reused for schema objects
 * @param schema
 * @param targetName
 */
function targetSchema(schema: Schema, targetName: string | symbol): Base {
    if (!Engine.isSchema(schema)) return Engine.object({[targetName]: schema})
    let byName: Map<string | symbol, Base> | undefined = targetSchemas.get(schema)
    if (!byName) {
        byName = new Map()
        targetSchemas.set(schema, byName)
    }
    let wrapper: Base | undefined = byName.get(targetName)
    if (!wrapper) {
        wrapper = Engine.object({[targetName]: schema})
        byName.set(targetName, wrapper)
    }
    return wrapper
}

class ValidateMethods {

    /**
     * Whether input is schema or not
     * @param schema
     */
    public isSchema(schema: any): boolean {
        return Engine.isSchema(schema)
    }

    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public isValid<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): boolean {
        try {
            this.validate(data, schema, options)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public async isValidAsync<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): Promise<boolean> {
        try {
            await this.validateAsync(data, schema, options)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public validate<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): T {
        options = mergeOptions(options)
        let error: Error | undefined
        let value: T
        if (options.targetName) {
            const result: EngineValidationResult = targetSchema(schema, options.targetName).validate({[options.targetName]: data}, As<Preferences>(options))
            error = result.error
            value = As<Record<symbol | string, T>>(result.value)[options.targetName]
        } else {
            const result: EngineValidationResult = As<Base>(schema).validate(data, As<Preferences>(options))
            error = result.error
            value = As<T>(result.value)
        }
        if (error) throw WithCause(new InvalidValueException(error.message), error)
        return value
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public async validateAsync<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): Promise<T> {
        options = mergeOptions(options)
        try {
            if (options.targetName) {
                const result: Record<symbol | string, T> = As<Record<symbol | string, T>>(await targetSchema(schema, options.targetName).validateAsync({[options.targetName]: data}, As<Preferences>(mergeOptions({
                    ...options,
                    artifacts: false
                }))))
                return result[options.targetName]
            } else {
                return As<T>(await As<Base>(schema).validateAsync(data, As<Preferences>(options)))
            }
        } catch (e) {
            throw WithCause(new InvalidValueException((e as Error).message), e)
        }
    }
}

export const VLD: ValidateAPI = As<ValidateAPI>(extendBigInt(Engine))

export const VLDMethods: ValidateMethods = new ValidateMethods()
