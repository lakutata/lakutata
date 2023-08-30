import 'reflect-metadata'
import sortArray from 'sort-array'
import {ISortArrayOptions} from './interfaces/ISortArrayOptions'
import {ISortObjectOptions} from './interfaces/ISortObjectOptions'
import isGlob from 'is-glob'
import * as randomString from 'randomstring'
import {IConstructor} from './interfaces/IConstructor'
import {BaseObject} from './lib/base/BaseObject'
import {OBJECT_INIT_MARK} from './constants/MetadataKey'
import {setTimeout} from 'timers/promises'
import {isPromise as isBuiltinPromises} from 'util/types'
import {Readable as ReadableStream, ReadableOptions, Stream} from 'stream'
import {PathLike} from 'fs'
import SortKeys from './lib/deps/SortKeys'
import pickFreePort from './lib/deps/PickFreePort'

/**
 * 对象转换为Map
 * @param obj
 * @constructor
 */
export function ObjectToMap<K extends (string | number | symbol), V>(obj: Record<K, V>): Map<K, V> {
    return As<Map<K, V>>(new Map(Object.entries(obj)))
}

/**
 * 选择一个没有被使用的网络端口
 * @param options
 * @constructor
 */
export async function GetPort(options?: {
    port?: number | number[];
    exclude?: Iterable<number>;
}): Promise<number> {
    return await pickFreePort(options)
}

/**
 * 判断两个传入的值是否相等
 * @param val1
 * @param val2
 * @constructor
 */
export function IsEqual(val1: any, val2: any): boolean {
    const compareSet: Set<any> = new Set()
    compareSet.add(val1).add(val2)
    return compareSet.size === 2
}

/**
 * 判断输入的内容是否为路径
 * @param inp
 * @constructor
 */
export function IsPath(inp: string | PathLike): boolean {
    try {
        const pathRegex: RegExp = new RegExp('^(\\/|\\.\\.?\\/|([A-Za-z]:)?\\\\)([^\\\\\\/:*?"<>|\\r\\n]+[\\\\\\/])*[^\\\\\\/:*?"<>|\\r\\n]*$')
        return pathRegex.test(As<string>(inp))
    } catch (e) {
        return false
    }
}

/**
 * 将输入对象转换为生成器对象
 * @param inp
 * @constructor
 */
export function* ConvertToIterable(inp: string | Buffer | NodeJS.TypedArray): Generator {
    for (let i = 0; i < inp.length; i++) yield inp[i]
}

/**
 * 转换Buffer为可读流
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertToStream(inp: Buffer, options?: ReadableOptions): ReadableStream
/**
 * 转换TypedArray为可读流
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertToStream(inp: NodeJS.TypedArray, options?: ReadableOptions): ReadableStream
/**
 * 转换字符串为可读流
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertToStream(inp: string, options?: ReadableOptions): ReadableStream
export function ConvertToStream(inp: any, options?: ReadableOptions): ReadableStream {
    options = options ? options : {}
    return Stream.Readable.from(ConvertToIterable(inp), options)
}

/**
 * 判断一个目标对象是否为Promise
 * @param target
 */
export function IsPromise(target: any): boolean {
    return isBuiltinPromises(target) ? true : !!target && (typeof target === 'object' || typeof target === 'function') && typeof target.then === 'function'
}

/**
 * 判断一个目标对象是否为PromiseLike
 * @param target
 * @constructor
 */
export function IsPromiseLike(target: any): boolean {
    if (IsPromise(target)) return true
    const {
        then
    } = target || false
    return (then instanceof Function)
}

/**
 * 异步等待
 * @param ms
 * @constructor
 */
export async function Delay(ms: number = 1000): Promise<void> {
    return await setTimeout(ms)
}

/**
 * 传递进来的参数不会有任何作用
 * @constructor
 */
export function DevNull(...args: any[]): void {
    return ThrowIntoBlackHole(...args)
}

/**
 * 传递进来的参数不会有任何作用
 * @constructor
 */
export function ThrowIntoBlackHole(...args: any[]): void {
    /**
     * 仅接受参数，但不对参数做任何处理
     */
}

/**
 * 对象是否已被初始化
 * @param obj
 * @constructor
 */
export function IsObjectInitialized<T extends BaseObject>(obj: T): boolean {
    return !!Reflect.getOwnMetadata(OBJECT_INIT_MARK, obj)
}

/**
 * 合并两个Set
 * @constructor
 * @param s1
 * @param s2
 */
export function MergeSet<T = any, U = any>(s1: Set<T>, s2: Set<U>): Set<T | U> {
    return new Set<T | U>([...s1, ...s2])
}

/**
 * 合并两个数组
 * @param arr1
 * @param arr2
 * @constructor
 */
export function MergeArray<T = any, U = any>(arr1: T[], arr2: U[]): (T | U)[] {
    return [...arr1, ...arr2]
}

/**
 * 合并两个Map
 * @constructor
 * @param m1
 * @param m2
 */
export function MergeMap<K1, V1, K2, V2>(m1: Map<K1, V1>, m2: Map<K2, V2>): Map<K1 | K2, V1 | V2> {
    return new Map<K1 | K2, V1 | V2>([...m1, ...m2])
}

/**
 * 集合转数组
 * @param set
 * @constructor
 */
export function SetToArray<T = any>(set: Set<T>): T[] {
    return Array.from(set)
}

/**
 * 数组转集合
 * @param arr
 * @constructor
 */
export function ArrayToSet<T = any>(arr: T[]): Set<T> {
    return new Set(arr)
}

/**
 * 数组去重
 * @param arr
 * @constructor
 */
export function UniqueArray<T>(arr: T[]): T[] {
    return Array.from(new Set(arr))
}

/**
 * 数组排序
 * @param arr
 * @param options
 * @constructor
 */
export function SortArray<T = any>(arr: T[], ...options: ISortArrayOptions<T>[]): T[] {
    if (options.length < 2) {
        let sortOptions: { [key: string]: any } = {order: 'asc'}
        if (options.length) sortOptions = Object.assign(sortOptions, {
            by: options[0].by,
            order: options[0].order,
            computed: options[0].computed
        })
        return sortArray(arr, sortOptions)
    } else {
        const sortsOptions: { [key: string]: any } = {
            by: [],
            order: [],
            customOrders: {}
        }
        options.forEach((opt: ISortArrayOptions<T>): void => {
            if (opt.by) {
                const field: string = opt.by as any
                sortsOptions.by.push(field)
                sortsOptions.order.push(field)
                sortsOptions.customOrders[field] = SortArray(arr, opt).map(value => value[field])
            }
        })
        return sortArray(arr, sortsOptions)
    }
}

/**
 * 对象排序
 * @param object
 * @param options
 * @constructor
 */
export function SortObject<T extends Record<string, any>>(object: T, options?: ISortObjectOptions): T {
    return SortKeys(object, {
        deep: options?.deep, compare: (a: string, b: string): number => {
            switch (options?.order) {
                case 'asc':
                    return a.localeCompare(b)
                case 'desc':
                    return -a.localeCompare(b)
                default:
                    return a.localeCompare(b)
            }
        }
    })
}

/**
 * 配置对象属性
 * @param target
 * @param properties
 * @constructor
 */
export function ConfigureObjectProperties<T extends object = object>(target: T, properties: Record<string, any>): void {
    Object.keys(properties ? properties : {}).forEach((propertyKey: string) => target[propertyKey] = properties![propertyKey])
}

/**
 * 类型转换
 * @param inp
 * @constructor
 */
export function As<T = any>(inp: any): T {
    return inp as T
}

/**
 * 判断是否为通配符匹配操作符字符串
 * @param inp
 */
export function IsGlobString(inp: string): boolean {
    return isGlob(inp)
}

/**
 * 生成随机字符串
 */
export function RandomString(): string
/**
 * 生成指定长度的随机字符串
 * @param length
 */
export function RandomString(length: number): string
/**
 * 生成仅包含字符集内字符的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: string): string
/**
 * 生成仅包含[0-9 a-z A-Z]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'alphanumeric'): string
/**
 * 生成仅包含[a-z A-Z]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'alphabetic'): string
/**
 * 生成仅包含[0-9]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'numeric'): string
/**
 * 生成仅包含[0-9 a-f]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'hex'): string
/**
 * 生成仅包含[01]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'binary'): string
/**
 * 生成仅包含[0-7]的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: 'octal'): string
/**
 * 生成仅包含字符集数组内字符规则的指定长度字符串
 * @param length
 * @param charset
 */
export function RandomString(length: number, charset: ('alphanumeric' | 'alphabetic' | 'numeric' | 'hex' | 'binary' | 'octal' | string)[]): string
export function RandomString(length?: number, charset?: string | string[]): string {
    return randomString.generate({
        length: length !== undefined ? length : 32,
        charset: As<string>(charset !== undefined ? charset : 'alphanumeric')
    })
}

/**
 * 生成32位的随机字符串
 * @constructor
 */
export function NonceStr(): string {
    return RandomString(32, 'alphanumeric')
}

/**
 * 获取类实例/构造函数所继承的父类的构造函数
 * @param target
 * @constructor
 */
export function ParentConstructor<T extends Function = any>(target: T): IConstructor<any> | null
export function ParentConstructor<T extends Function = any>(target: IConstructor<T>): IConstructor<any> | null {
    const rootProto: unknown = Symbol.constructor.prototype.constructor.__proto__
    const constructor: Function = (!!target[Symbol.hasInstance] && target.prototype) ? target : target.constructor
    const proto: IConstructor<any> = constructor.prototype.constructor.__proto__
    return proto === rootProto ? null : proto
}
