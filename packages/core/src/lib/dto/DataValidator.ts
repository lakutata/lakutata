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
import {As} from '@lakutata/utils/helper/As'
import {IsGlobString} from '@lakutata/utils/helper/IsGlobString'
import {IsHtml} from '@lakutata/utils/helper/IsHtml'
import {IsXML} from '@lakutata/utils/helper/IsXML'
import {ErrorReport} from '../validation/interfaces/ErrorReport.js'

//Self-implemented (replaces the `cron-validator` package dependency).
type CronOptions = { seconds?: boolean; allowBlankDay?: boolean; allowSevenAsSunday?: boolean; alias?: boolean }
const _isValidField = (field: string, min: number, max: number, allowBlank: boolean): boolean => {
    if (field === '*' || (allowBlank && field === '?')) return true
    if (field.startsWith('@')) return true
    const [base, stepStr] = field.split('/')
    const step = stepStr ? parseInt(stepStr, 10) : 1
    if (isNaN(step) || step < 1) return false
    if (base === '*') return true
    for (const part of base.split(',')) {
        if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number)
            if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) return false
        } else {
            const n = parseInt(part, 10)
            if (isNaN(n) || n < min || n > max) return false
        }
    }
    return true
}
function isValidCron(cron: string, opts?: CronOptions): boolean {
    const parts = cron.trim().split(/\s+/)
    const hasSeconds = opts?.seconds ?? false
    const maxSun = opts?.allowSevenAsSunday ? 7 : 6
    const ranges = hasSeconds ? [[0,59],[0,59],[0,23],[1,31],[1,12],[0,maxSun]] : [[0,59],[0,23],[1,31],[1,12],[0,maxSun]]
    if (parts.length !== ranges.length) return false
    return parts.every((p, i) => _isValidField(p, ranges[i][0], ranges[i][1], !!opts?.allowBlankDay))
}
import {ReferenceOptions} from '../validation/interfaces/ReferenceOptions.js'
import {Reference} from '../validation/interfaces/Reference.js'
import {LinkSchema} from '../validation/interfaces/LinkSchema.js'
import {BigIntSchema} from '../validation/interfaces/BigIntSchema.js'
import {pure} from '../validation/engine/schema/fastpath.js'

export class DataValidator {

    /**
     * Rebuild a schema from its description (the output of schema.describe()), exactly
     * @param description
     * @constructor
     */
    public static Build<TSchema = any>(description: Description): Schema<TSchema> {
        return (VLD as unknown as { build(description: Description): Schema<TSchema> }).build(description)
    }

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
     * 大数类型验证
     * @constructor
     */
    public static BigInt<TSchema = bigint>(): BigIntSchema<TSchema> {
        return VLD.bigint<TSchema>().strict(true)
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
        return VLD.array().items<TSchema>(...types as any).strict(true)
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
     * 类验证器
     * @param inheritsFrom
     * @constructor
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
     * Is object instanceOf a constructor
     * @param constructor
     * @constructor
     */
    public static InstanceOf<TSchema = Function>(constructor: TSchema): AnySchema<TSchema> {
        return this.Any<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (value instanceof As(constructor) || value['prototype'] instanceof As(constructor)) return value
            return helpers.error('any.invalid')
        }), 'Class Instance Validation')
    }

    /**
     * 通配符匹配操作符字符串验证器
     * @constructor
     */
    public static Glob<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && IsGlobString(value)) return value
            return helpers.error('any.invalid')

        }), 'Glob Validation')
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
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            options = options ? options : {}
            options.alias = options.alias !== undefined ? options.alias : false
            options.seconds = options.seconds !== undefined ? options.seconds : true
            options.allowBlankDay = options.allowBlankDay !== undefined ? options.allowBlankDay : true
            options.allowSevenAsSunday = options.allowSevenAsSunday !== undefined ? options.allowSevenAsSunday : true
            if (typeof value === 'string' && isValidCron(value, options)) return value
            return helpers.error('any.invalid')
        }), 'Cron Validation')
    }

    /**
     * Http请求中Document类型数据验证器
     * @constructor
     */
    public static HttpDocument<TSchema = string>(): StringSchema<TSchema> {
        return this.String<TSchema>().custom(pure((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && (IsHtml(value) || IsXML(value))) return value
            return helpers.error('any.invalid')
        }), 'HttpDocument Validation')
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

    /**
     * 创建关联验证关系，用于递归验证
     * 绝对路径链接：/
     * 相对路径链接：...
     * @param ref
     * @constructor
     */
    public static Link<TSchema extends Schema>(ref: string): LinkSchema<TSchema> {
        return VLD.link(ref)
    }
}
