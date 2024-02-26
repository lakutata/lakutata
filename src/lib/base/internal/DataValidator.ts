import 'reflect-metadata'
import Joi, {
    AlternativesSchema,
    AnySchema,
    ArraySchema,
    BinarySchema,
    BooleanSchema, CustomHelpers,
    DateSchema,
    ErrorReport,
    FunctionSchema,
    NumberSchema,
    ObjectSchema,
    Reference,
    ReferenceOptions,
    Schema,
    SchemaLike,
    SchemaLikeWithoutArray,
    SchemaMap,
    StringSchema, SymbolSchema,
    ValidationOptions
} from 'joi'
import {InvalidValueException} from '../../../exceptions/dto/InvalidValueException.js'
import {isAsyncFunction} from 'node:util/types'
import {As} from '../func/As.js'
import {IsHtml} from '../func/IsHtml.js'
import {IsXML} from '../func/IsXML.js'
import {isValidCron} from 'cron-validator'
import {IsGlobString} from '../func/IsGlobString.js'

export const DefaultValidationOptions: ValidationOptions = {
    abortEarly: true,
    cache: false,
    allowUnknown: true,
    stripUnknown: true
    // debug: false
}

export class DataValidator extends Object {

    /**
     * 任意类型验证
     * @constructor
     */
    public static Any<TSchema = any>(): AnySchema<TSchema> {
        return Joi.any<TSchema>().strict(true)
    }

    /**
     * 字符串类型验证
     * @constructor
     */
    public static String<TSchema = string>(): StringSchema<TSchema> {
        return Joi.string<TSchema>().strict(true)
    }

    /**
     * 数字类型验证
     * @constructor
     */
    public static Number<TSchema = number>(): NumberSchema<TSchema> {
        return Joi.number<TSchema>().strict(true)
    }

    /**
     * 布尔类型验证
     * @constructor
     */
    public static Boolean<TSchema = boolean>(): BooleanSchema<TSchema> {
        return Joi.boolean<TSchema>().strict(true)
    }

    /**
     * 日期类型验证
     * @constructor
     */
    public static Date<TSchema = Date>(): DateSchema<TSchema> {
        return Joi.date<TSchema>().strict(true)
    }

    /**
     * 对象类型验证
     * @param schema
     * @constructor
     */
    public static Object<TSchema = any, isStrict = false, T = TSchema>(schema?: SchemaMap<T, isStrict>): ObjectSchema<TSchema> {
        return Joi.object<TSchema, isStrict, T>(schema as any).strict(true)
    }

    /**
     * 数组类型验证
     * @param types
     * @constructor
     */
    public static Array<TSchema = any[]>(...types: SchemaLikeWithoutArray[]): ArraySchema<TSchema> {
        return Joi.array<TSchema>().items(...types).strict(true)
    }

    /**
     * 二进制类型验证
     * @constructor
     */
    public static Binary<TSchema = Buffer>(): BinarySchema<TSchema> {
        return Joi.binary<TSchema>().strict(true)
    }

    /**
     * 方法类型验证
     * @constructor
     */
    public static Function<TSchema = Function>(): FunctionSchema<TSchema> {
        return Joi.func<TSchema>().strict(true)
    }

    /**
     * 异步方法类型验证
     * @constructor
     */
    public static AsyncFunction<TSchema = Function>(): FunctionSchema<TSchema> {
        return this.Function<TSchema>().custom((value: TSchema, helpers) => {
            if (isAsyncFunction(value)) return value
            return helpers.error('asyncFunc.invalid')
        }, 'Async Function Validation').error((errors: ErrorReport[]) => {
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
     * 类验证器
     * @param inheritsFrom
     * @constructor
     */
    public static Class<TSchema = Function>(inheritsFrom?: TSchema | (() => TSchema)): FunctionSchema<TSchema> {
        if (!inheritsFrom) return Joi.func<TSchema>().class()
        return this.Function<TSchema>().class().custom((value: TSchema, helpers: CustomHelpers) => {
            if (!As<() => TSchema>(inheritsFrom).prototype) inheritsFrom = As<() => TSchema>(inheritsFrom)()
            if (value instanceof As(inheritsFrom) || value['prototype'] instanceof As(inheritsFrom)) return value
            return helpers.error('any.invalid')
        }, 'Class Validation')
    }

    /**
     * 通配符匹配操作符字符串验证器
     * @constructor
     */
    public static Glob<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && IsGlobString(value)) return value
            return helpers.error('any.invalid')

        }, 'Glob Validation')
    }

    /**
     * Cron表达式验证器
     * @constructor
     */
    public static Cron<TSchema = string>(options?: {
        alias?: boolean
        seconds?: boolean
        allowBlankDay?: boolean
        allowSevenAsSunday?: boolean
    }): StringSchema<TSchema> {
        return this.String<TSchema>().custom((value: TSchema, helpers: CustomHelpers) => {
            options = options ? options : {}
            options.alias = options.alias !== undefined ? options.alias : false
            options.seconds = options.seconds !== undefined ? options.seconds : true
            options.allowBlankDay = options.allowBlankDay !== undefined ? options.allowBlankDay : true
            options.allowSevenAsSunday = options.allowSevenAsSunday !== undefined ? options.allowSevenAsSunday : true
            if (typeof value === 'string' && isValidCron(value, options)) return value
            return helpers.error('any.invalid')
        }, 'Cron Validation')
    }

    /**
     * Http请求中Document类型数据验证器
     * @constructor
     */
    public static HttpDocument<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && (IsHtml(value) || IsXML(value))) return value
            return helpers.error('any.invalid')
        }, 'HttpDocument Validation')
    }

    /**
     * 符号类型验证
     * @constructor
     */
    public static Symbol<TSchema = Symbol>(): SymbolSchema<TSchema> {
        return Joi.symbol<TSchema>().strict(true)
    }

    /**
     * 可选参数类型验证
     * @param types
     * @constructor
     */
    public static Alternatives<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema> {
        //@ts-ignore
        return Joi.alternatives<TSchema>(...types).strict(true)
    }

    /**
     * 为已命名的键值生成引用
     * @param key
     * @param options
     * @constructor
     */
    public static Ref(key: string, options?: ReferenceOptions): Reference {
        return Joi.ref(key, options)
    }

    /**
     * 将一个键标记为禁止，该键将不允许除undefined以外的任何值。用于明确禁止键。
     * @constructor
     */
    public static Forbidden(): Schema {
        return Joi.forbidden().strict(true)
    }

    /**
     * 创建一个引用，当解析时，将其作为值数组用于与规则进行匹配。
     * @param ref
     * @param options
     * @constructor
     */
    public static In(ref: string, options?: ReferenceOptions): Reference {
        return Joi.in(ref, options)
    }

    /**
     * 对值进行模式验证，返回有效的对象，如果验证失败则抛出异常。
     * @param value
     * @param schema
     * @param options
     * @constructor
     */
    public static Attempt<TSchema extends Schema>(value: any, schema: TSchema, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never {
        return Joi.attempt(value, schema, options) as any
    }

    /**
     * 根据Schema判断数据是否正确（同步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static isValid<T = any>(data: T, schema: Schema, options?: ValidationOptions): boolean {
        try {
            this.validate(data, schema, options)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * 根据Schema判断数据是否正确（异步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema, options?: ValidationOptions): Promise<boolean> {
        try {
            await this.validateAsync(data, schema, options)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * 根据Schema验证数据（同步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static validate<T = any>(data: T, schema: Schema, options?: ValidationOptions): T {
        options = options ? Object.assign({}, DefaultValidationOptions, options) : DefaultValidationOptions
        const {error, value} = schema.validate(data, options)
        if (error) throw new InvalidValueException(error.message)
        return value
    }

    /**
     * 根据Schema验证数据（异步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static async validateAsync<T = any>(data: T, schema: Schema, options?: ValidationOptions): Promise<T> {
        options = options ? Object.assign({}, DefaultValidationOptions, options) : DefaultValidationOptions
        try {
            return await schema.validateAsync(data, options)
        } catch (e) {
            throw new InvalidValueException((e as Error).message)
        }
    }
}
