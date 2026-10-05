import {ActionPattern} from '@lakutata/core'
import {sortArray} from '@lakutata/utils'

function patternToArrayPair(pattern: ActionPattern | any): any {
    switch (typeof pattern) {
        case 'string':
            return pattern
        case 'boolean':
            return pattern ? 'true' : 'false'
        case 'number':
            return pattern.toString()
        case 'bigint':
            return undefined
        case 'symbol':
            return undefined
        case 'function':
            return undefined
        case 'undefined':
            return undefined
        case 'object': {
            if (Array.isArray(pattern)) {
                const arrayData: any[] = []
                sortArray(pattern, {order: 'asc'}).forEach((item: any) => {
                    const newItem: any = patternToArrayPair(item)
                    if (newItem === undefined) return
                    arrayData.push(newItem)
                })
                return arrayData
            } else {
                const keys: string[] = sortArray(Object.keys(pattern), {order: 'asc'})
                const data: any[] = []
                keys.forEach((key: string) => {
                    const item: any = patternToArrayPair(pattern[key])
                    if (item === undefined) return
                    data.push([key, item])
                })
                return data
            }
        }
        default:
            return undefined
    }
}

/**
 * Stringify pattern object
 * @param pattern
 * @constructor
 */
export function stringifyPattern(pattern: ActionPattern): string {
    let pairArr: any[] = patternToArrayPair(pattern)
    while (pairArr.find((value: any) => Array.isArray(value))) pairArr = pairArr.flat()
    return pairArr.join(':')
}