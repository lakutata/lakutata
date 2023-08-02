import 'reflect-metadata'
import sortArray from 'sort-array'
import {ISortArrayOptions} from './interfaces/ISortArrayOptions.js'
import sortKeys from 'sort-keys'
import {ISortObjectOptions} from './interfaces/ISortObjectOptions.js'
import isGlob from 'is-glob'

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
    return sortKeys(object, {
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
export function isGlobString(inp: string): boolean {
    return isGlob(inp)
}
