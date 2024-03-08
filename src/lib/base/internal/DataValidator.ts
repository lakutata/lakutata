import 'reflect-metadata'
import {isAsyncFunction} from 'node:util/types'
import {isValidCron} from 'cron-validator'
import {AnySchema} from '../../validation/interfaces/AnySchema.js'
import {VLD} from '../../validation/VLD.js'
import {StringSchema} from '../../validation/interfaces/StringSchema.js'
import {NumberSchema} from '../../validation/interfaces/NumberSchema.js'
import {BooleanSchema} from '../../validation/interfaces/BooleanSchema.js'
import {DateSchema} from '../../validation/interfaces/DateSchema.js'
import {SchemaLikeWithoutArray} from '../../validation/types/SchemaLikeWithoutArray.js'
import {ArraySchema} from '../../validation/interfaces/ArraySchema.js'
import {SchemaMap} from '../../validation/types/SchemaMap.js'
import {ObjectSchema} from '../../validation/interfaces/ObjectSchema.js'
import {Schema} from '../../validation/types/Schema.js'
import {ValidationOptions} from '../../validation/interfaces/ValidationOptions.js'
import {ErrorReport, Reference, ReferenceOptions} from 'joi'
import {SchemaLike} from '../../validation/types/SchemaLike.js'
import {AlternativesSchema} from '../../validation/interfaces/AlternativesSchema.js'
import {SymbolSchema} from '../../validation/interfaces/SymbolSchema.js'
import {CustomHelpers} from '../../validation/interfaces/CustomHelpers.js'
import {FunctionSchema} from '../../validation/interfaces/FunctionSchema.js'
import {BinarySchema} from '../../validation/interfaces/BinarySchema.js'
import {As} from '../../functions/As.js'
import {IsGlobString} from '../../functions/IsGlobString.js'
import {IsHtml} from '../../functions/IsHtml.js'
import {IsXML} from '../../functions/IsXML.js'

export class DataValidator {

    /**
     * 任意类型验证
     * @constructor
     */
    public static Any<TSchema = any>(): AnySchema<TSchema> {
        return VLD.any<TSchema>().strict(true)
    }

    /**
     * 字符串类型验证
     * @constructor
     */
    public static String<TSchema = string>(): StringSchema<TSchema> {
        return VLD.string<TSchema>().strict(true)
    }

    /**
     * 数字类型验证
     * @constructor
     */
    public static Number<TSchema = number>(): NumberSchema<TSchema> {
        return VLD.number<TSchema>().strict(true)
    }

    /**
     * 布尔类型验证
     * @constructor
     */
    public static Boolean<TSchema = boolean>(): BooleanSchema<TSchema> {
        return VLD.boolean<TSchema>().strict(true)
    }

    /**
     * 日期类型验证
     * @constructor
     */
    public static Date<TSchema = Date>(): DateSchema<TSchema> {
        return VLD.date<TSchema>().strict(true)
    }

    /**
     * 对象类型验证
     * @param schema
     * @constructor
     */
    public static Object<TSchema = any, isStrict = false, T = TSchema>(schema?: SchemaMap<T, isStrict>): ObjectSchema<TSchema> {
        return VLD.object<TSchema, isStrict, T>(schema as any).strict(true)
    }

    /**
     * 数组类型验证
     * @param types
     * @constructor
     */
    public static Array<TSchema = any[]>(...types: SchemaLikeWithoutArray[]): ArraySchema<TSchema> {
        return VLD.array<TSchema>().items(...types).strict(true)
    }

    /**
     * 二进制类型验证
     * @constructor
     */
    public static Binary<TSchema = Buffer>(): BinarySchema<TSchema> {
        return VLD.binary<TSchema>().strict(true)
    }

    /**
     * 方法类型验证
     * @constructor
     */
    public static Function<TSchema = Function>(): FunctionSchema<TSchema> {
        return VLD.func<TSchema>().strict(true)
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
        if (!inheritsFrom) return VLD.func<TSchema>().class()
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
        return VLD.symbol<TSchema>().strict(true)
    }

    /**
     * 可选参数类型验证
     * @param types
     * @constructor
     */
    public static Alternatives<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema> {
        //@ts-ignore
        return VLD.alternatives<TSchema>(...types).strict(true)
    }

    /**
     * 为已命名的键值生成引用
     * @param key
     * @param options
     * @constructor
     */
    public static Ref(key: string, options?: ReferenceOptions): Reference {
        return VLD.ref(key, options)
    }

    /**
     * 创建一个引用，当解析时，将其作为值数组用于与规则进行匹配。
     * @param ref
     * @param options
     * @constructor
     */
    public static In(ref: string, options?: ReferenceOptions): Reference {
        return VLD.in(ref, options)
    }

    /**
     * 对值进行模式验证，返回有效的对象，如果验证失败则抛出异常。
     * @param value
     * @param schema
     * @param options
     * @constructor
     */
    public static Attempt<TSchema extends Schema>(value: any, schema: TSchema, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never {
        return VLD.attempt(value, schema, options) as any
    }
}
