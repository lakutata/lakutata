import sortArray from 'sort-array'
import {ISortArrayOptions} from './interfaces/ISortArrayOptions.js'

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
