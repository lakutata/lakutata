/**
 * Derived from index.js of sort-array 5.1.1, of array-back 6.2.3 and of typical 7.3.0 (MIT, see
 * THIRD_PARTY_NOTICES.md): the sorting of 2.x, in place
 */

export interface SortArrayOptions<Computed> {
    by?: string | string[]
    order?: string | string[]
    customOrders?: { [key: string]: any }
    computed?: { [key: string]: (item: Computed) => number | string | boolean | bigint | symbol | null | undefined }
    nullRank?: -1 | 1
    undefinedRank?: -1 | 1
}

/**
 * The options of sort-array, with their defaults
 */
type SortSettings = {
    by?: any
    order?: any
    customOrders: Record<string, any>
    computed: Record<string, (item: any) => any>
    nullRank: number
    undefinedRank: number
    nanRank: number
}

/**
 * An array of a value (array-back)
 * @param input
 */
function Arrayify(input: any): any[] {
    if (Array.isArray(input)) return input
    if (input === undefined) return []
    if ((typeof input === 'object' && input !== null && typeof input.length === 'number') || input instanceof Set) return Array.from(input)
    return [input]
}

/**
 * Not undefined, null nor NaN (typical)
 * @param input
 */
function IsDefinedValue(input: any): boolean {
    return input !== undefined && input !== null && !Number.isNaN(input)
}

/**
 * The comparison of the items of sort-array
 * @param options
 */
function CompareFunction(options: SortSettings): (xIn: any, yIn: any, byIndex?: number) => number {
    const by: any[] = Arrayify(options.by)
    const order: any[] = Arrayify(options.order)
    const {customOrders, computed} = options
    const compare = (xIn: any, yIn: any, byIndex: number = 0): number => {
        const currOrder: any = order[byIndex] || 'asc'
        if (!(currOrder === 'asc' || currOrder === 'desc' || customOrders[currOrder])) return 0
        let result: number
        let x: any
        let y: any
        if (by.length) {
            x = xIn[by[byIndex]] !== undefined ? xIn[by[byIndex]] : computed[by[byIndex]] && computed[by[byIndex]](xIn)
            y = yIn[by[byIndex]] !== undefined ? yIn[by[byIndex]] : computed[by[byIndex]] && computed[by[byIndex]](yIn)
        } else {
            x = xIn
            y = yIn
        }
        if (customOrders && customOrders[currOrder]) {
            result = customOrders[currOrder].indexOf(x) - customOrders[currOrder].indexOf(y)
        } else if (x === y) {
            result = 0
        } else if (x === null && y === undefined) {
            result = currOrder === 'asc' ? 1 : currOrder === 'desc' ? -1 : 0
        } else if (x === undefined && y === null) {
            result = currOrder === 'asc' ? -1 : currOrder === 'desc' ? 1 : 0
        } else if (x === null && IsDefinedValue(y)) {
            result = options.nullRank
        } else if (x === undefined && IsDefinedValue(y)) {
            result = options.undefinedRank
        } else if (Number.isNaN(x) && IsDefinedValue(y)) {
            result = options.nanRank
        } else if (y === null && IsDefinedValue(x)) {
            result = -options.nullRank
        } else if (y === undefined && IsDefinedValue(x)) {
            result = -options.undefinedRank
        } else if (Number.isNaN(y) && IsDefinedValue(x)) {
            result = -options.nanRank
        } else {
            result = x < y ? -1 : x > y ? 1 : 0
            if (currOrder === 'desc') result = result * -1
        }
        if (result === 0 && by[byIndex + 1] !== undefined) result = compare(xIn, yIn, byIndex + 1)
        return result
    }
    return compare
}

/**
 * Sort an array in place (sort-array)
 * @param array
 * @param options
 */
function Sort<T>(array: T[], options: Partial<SortSettings> = {}): T[] {
    const settings: SortSettings = Object.assign({computed: {}, customOrders: {}, nullRank: 1, undefinedRank: 1, nanRank: 1}, options)
    //The comparison is called with two arguments (the byIndex of the first property)
    const compare: (xIn: any, yIn: any, byIndex?: number) => number = CompareFunction(settings)
    array.sort((x: T, y: T): number => compare(x, y))
    return array
}

/**
 * Sort an array in place, and return it. With one set of options, by its properties, order and computed fields (an
 * ascending order without options); with several, by the properties of the sets, each one in the order given by the
 * set alone
 * @param array
 * @param options
 * @constructor
 */
export function SortArray<T = any>(array: T[], ...options: SortArrayOptions<T>[]): T[] {
    if (options.length < 2) {
        let sortOptions: { [key: string]: any } = {order: 'asc'}
        if (options.length) sortOptions = Object.assign(sortOptions, {
            by: options[0].by,
            order: options[0].order,
            computed: options[0].computed
        })
        return Sort(array, sortOptions)
    }
    const sortsOptions: { [key: string]: any } = {
        by: [],
        order: [],
        customOrders: {}
    }
    options.forEach((opt: SortArrayOptions<T>): void => {
        if (!opt.by) return
        const field: string = opt.by as any
        sortsOptions.by.push(field)
        sortsOptions.order.push(field)
        sortsOptions.customOrders[field] = SortArray(array, opt).map((value: any): any => value[field])
    })
    return Sort(array, sortsOptions)
}
