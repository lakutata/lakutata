import {SortKeys} from './SortKeys.js'

/**
 * Sort keys options
 */
export interface SortObjectOptions {
    deep?: boolean
    order?: 'asc' | 'desc'
}

/**
 * Sort object
 * @param object
 * @param options
 * @constructor
 */
export function SortObject<T extends Record<string, any>>(object: T, options?: SortObjectOptions): T {
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
