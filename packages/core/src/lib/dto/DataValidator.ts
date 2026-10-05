import 'reflect-metadata'
import {isAsyncFunction} from 'node:util/types'
import {AnySchema} from '../validation/interfaces/AnySchema.js'
import {VLD} from '../validation/VLD.js'
import type {Description} from '../validation/interfaces/Description.js'
import {StringSchema} from '../validation/interfaces/StringSchema.js'
import {NumberSchema} from '../validation/interfaces/NumberSchema.js'
import {BooleanSchema} from '../validation/interfaces/BooleanSchema.js'
import {DateSchema} from '../validation/interfaces/DateSchema.js'
import {SchemaLikeWithoutArray} from '../validation/types/SchemaLikeWithoutArray.js'
import {ArraySchema} from '../validation/interfaces/ArraySchema.js'
import {SchemaMap} from '../validation/types/SchemaMap.js'
import {ObjectSchema} from '../validation/interfaces/ObjectSchema.js'
import {Schema} from '../validation/types/Schema.js'
import {ValidationOptions} from '../validation/interfaces/ValidationOptions.js'
import {SchemaLike} from '../validation/types/SchemaLike.js'
import {AlternativesSchema} from '../validation/interfaces/AlternativesSchema.js'
import {SymbolSchema} from '../validation/interfaces/SymbolSchema.js'
import {CustomHelpers} from '../validation/interfaces/CustomHelpers.js'
import {FunctionSchema} from '../validation/interfaces/FunctionSchema.js'
import {BinarySchema} from '../validation/interfaces/BinarySchema.js'
import {As} from '@lakutata/utils/As'
import {isGlobString} from '@lakutata/utils/IsGlobString'
import {isHTML} from '@lakutata/utils/IsHTML'
import {isXML} from '@lakutata/utils/IsXML'
import {ErrorReport} from '../validation/interfaces/ErrorReport.js'

import {ReferenceOptions} from '../validation/interfaces/ReferenceOptions.js'
import {Reference} from '../validation/interfaces/Reference.js'
import {LinkSchema} from '../validation/interfaces/LinkSchema.js'
import {BigIntSchema} from '../validation/interfaces/BigIntSchema.js'
import {pure} from '../validation/engine/schema/fastpath.js'
import {type CronOptions} from '../../types/CronOptions.js'
import {IsValidCron} from './internal/CronValidator.js'

export class DataValidator {

    /**
     * Rebuild a schema from its description (the output of `schema.describe()`), exactly.
     * @param description The description of the schema.
     * @returns The schema.
     */
    public static Build<TSchema = any>(description: Description): Schema<TSchema> {
        return (VLD as unknown as { build(description: Description): Schema<TSchema> }).build(description)
    }

    /**
     * Build a schema accepting any value (`undefined` included unless marked `required()`).
     * @returns A new schema.
     */
    public static Any<TSchema = any>(): AnySchema<TSchema> {
        return VLD.any<TSchema>().strict(true)
    }

    /**
     * Build a schema of strings; strict: a value of another type is rejected, not converted.
     * @returns A new string schema.
     */
    public static String<TSchema = string>(): StringSchema<TSchema> {
        return VLD.string<TSchema>().strict(true)
    }

    /**
     * Build a schema of numbers; strict: a value of another type is rejected, not converted (the string `'5'` is not
     * the number 5).
     * @returns A new number schema.
     */
    public static Number<TSchema = number>(): NumberSchema<TSchema> {
        return VLD.number<TSchema>().strict(true)
    }

    /**
     * Build a schema of bigints; strict: a value of another type is rejected, not converted.
     * @returns A new bigint schema.
     */
    public static BigInt<TSchema = bigint>(): BigIntSchema<TSchema> {
        return VLD.bigint<TSchema>().strict(true)
    }

    /**
     * Build a schema of booleans; strict: a value of another type is rejected, not converted (the string `'true'` is
     * not a boolean).
     * @returns A new boolean schema.
     */
    public static Boolean<TSchema = boolean>(): BooleanSchema<TSchema> {
        return VLD.boolean<TSchema>().strict(true)
    }

    /**
     * Build a schema of `Date` objects; strict: a value of another type is rejected, not converted (a date string or a
     * timestamp is not a date).
     * @returns A new date schema.
     */
    public static Date<TSchema = Date>(): DateSchema<TSchema> {
        return VLD.date<TSchema>().strict(true)
    }

    /**
     * Build a schema of objects, with the schemas of their keys; strict. With the default validation options, the keys
     * without schema are removed.
     * @param schema The schemas of the keys, by key. Default: no key declared.
     * @returns A new object schema.
     */
    public static Object<TSchema = any, isStrict = false, T = TSchema>(schema?: SchemaMap<T, isStrict>): ObjectSchema<TSchema> {
        return VLD.object<TSchema, isStrict, T>(schema as any).strict(true)
    }

    /**
     * Build a schema of arrays whose items match one of the schemas given; strict.
     * @param types The schemas an item may match. Default: any item.
     * @returns A new array schema.
     */
    public static Array<TSchema = any[]>(...types: SchemaLikeWithoutArray[]): ArraySchema<TSchema> {
        return VLD.array().items<TSchema>(...types as any).strict(true)
    }

    /**
     * Build a schema of `Buffer`s; strict: a value of another type is rejected, not converted.
     * @returns A new binary schema.
     */
    public static Binary<TSchema = Buffer>(): BinarySchema<TSchema> {
        return VLD.binary<TSchema>().strict(true)
    }

    /**
     * Build a schema of functions; strict.
     * @returns A new function schema.
     */
    public static Function<TSchema = Function>(): FunctionSchema<TSchema> {
        return VLD.func<TSchema>().strict(true)
    }

    /**
     * Build a schema of async functions (declared `async`); a function which only returns a promise is rejected.
     * @returns A new function schema.
     */
    public static AsyncFunction<TSchema = Function>(): FunctionSchema<TSchema> {
        return this.Function<TSchema>().custom(pure((value: TSchema, helpers) => {
            if (isAsyncFunction(value)) return value
            return helpers.error('asyncFunc.invalid')
        }), 'Async Function Validation').error((errors: ErrorReport[]) => {
            for (const error of errors) {
                if (error.code === 'asyncFunc.invalid') {
                    error.message = 'Expected AsyncFunction but got Function'
                    return error
                }
            }
            return errors[0]
        })
    }

    /**
     * Build a schema of classes, optionally of the subclasses of a class.
     * @param inheritsFrom The class the value must be or extend, or a function returning it (for a class declared
     * later). Default: any class.
     * @returns A new function schema.
     */
    public static Class<TSchema = Function>(inheritsFrom?: TSchema | (() => TSchema)): FunctionSchema<TSchema> {
        if (!inheritsFrom) return VLD.func<TSchema>().class()
        return this.Function<TSchema>().class().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (!As<() => TSchema>(inheritsFrom).prototype) inheritsFrom = As<() => TSchema>(inheritsFrom)()
            if (value instanceof As(inheritsFrom) || value['prototype'] instanceof As(inheritsFrom)) return value
            return helpers.error('any.invalid')
        }), 'Class Validation')
    }

    /**
     * Build a schema of the instances of a class (the instances of its subclasses included).
     * @param constructor The class.
     * @returns A new schema.
     */
    public static InstanceOf<TSchema = Function>(constructor: TSchema): AnySchema<TSchema> {
        return this.Any<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (value instanceof As(constructor) || value['prototype'] instanceof As(constructor)) return value
            return helpers.error('any.invalid')
        }), 'Class Instance Validation')
    }

    /**
     * Build a schema of glob pattern strings (`*.ts`, `src/**`).
     * @returns A new string schema.
     */
    public static Glob<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && isGlobString(value)) return value
            return helpers.error('any.invalid')

        }), 'Glob Validation')
    }

    /**
     * Build a schema of cron expression strings. The options not given default to: seconds allowed (6 fields), `?`
     * allowed for a day, 7 accepted as Sunday, no aliases (`@daily`).
     * @param options The cron syntax accepted.
     * @returns A new string schema.
     */
    public static Cron<TSchema = string>(options?: CronOptions): StringSchema<TSchema> {
        //The defaults of 2.x for the options not given (undefined): the seconds allowed, "?" for a day, 7 as Sunday; the
        //options given are left unchanged
        const cronOptions: CronOptions = {
            ...options,
            alias: options?.alias !== undefined ? options.alias : false,
            seconds: options?.seconds !== undefined ? options.seconds : true,
            allowBlankDay: options?.allowBlankDay !== undefined ? options.allowBlankDay : true,
            allowSevenAsSunday: options?.allowSevenAsSunday !== undefined ? options.allowSevenAsSunday : true
        }
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && IsValidCron(value, cronOptions)) return value
            return helpers.error('any.invalid')
        }), 'Cron Validation')
    }

    /**
     * Build a schema of HTML or XML document strings.
     * @returns A new string schema.
     */
    public static HttpDocument<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && (isHTML(value) || isXML(value))) return value
            return helpers.error('any.invalid')
        }), 'HttpDocument Validation')
    }

    /**
     * Build a schema of symbols; strict.
     * @returns A new symbol schema.
     */
    public static Symbol<TSchema = Symbol>(): SymbolSchema<TSchema> {
        return VLD.symbol<TSchema>().strict(true)
    }

    /**
     * Build a schema matching a value against several schemas, in order: the first one matching validates it.
     * @param types The schemas tried in order.
     * @returns A new alternatives schema.
     */
    public static Alternatives<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema> {
        return VLD.alternatives<TSchema>(...types).strict(true)
    }

    /**
     * Create a reference to another value of the validated object (a sibling key by default), resolved at validation,
     * for the rules comparing values (`DTO.Number().greater(DTO.Ref('min'))`).
     * @param key The path of the referenced value: a key, `a.b` for a nested key, `/key` from the root.
     * @param options How the reference is resolved.
     * @returns The reference.
     */
    public static Ref(key: string, options?: ReferenceOptions): Reference {
        return VLD.ref(key, options)
    }

    /**
     * Create a reference to an array of the validated object, whose items are the values allowed, for `valid()` or
     * `invalid()`.
     * @param ref The path of the referenced array.
     * @param options How the reference is resolved.
     * @returns The reference.
     */
    public static In(ref: string, options?: ReferenceOptions): Reference {
        return VLD.in(ref, options)
    }

    /**
     * Validate a value against a schema and return the validated value. Unlike `DTO.validate()`, the default options of
     * lakutata are not applied: an unknown key is rejected, not removed.
     * @param value The value to validate.
     * @param schema The schema to validate against.
     * @param options The validation options.
     * @returns The validated value.
     * @throws {SchemaValidationException} When the value does not match the schema.
     */
    public static Attempt<TSchema extends Schema>(value: any, schema: TSchema, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never {
        return VLD.attempt(value, schema, options) as any
    }

    /**
     * Build a schema linking to another schema of the same tree, for the recursive structures (a tree of nodes): `#id`
     * for the schema given that id, `/` for the root, `...` for an ancestor.
     * @param ref The path of the linked schema.
     * @returns A new link schema.
     */
    public static Link<TSchema extends Schema>(ref: string): LinkSchema<TSchema> {
        return VLD.link(ref)
    }
}
