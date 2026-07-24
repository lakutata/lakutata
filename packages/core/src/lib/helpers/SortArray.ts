import sortArray from 'sort-array'

export interface SortOptions<Computed> {
    /**
     * One or more property names or computed fields to sort by.
     * Specifying property names is only relevant when sorting an array of
     * objects.
     */
    by?: string | string[]
    /**
     * One or more sort orders. Specify 'asc', 'desc' or a property name from
     * the options.customOrders object.
     */
    order?: string | string[]
    /**
     * A dictionary object containing one or more custom orders. Each custom
     * order value must be an array defining the order expected values must be
     * sorted in.
     */
    customOrders?: {
        [key: string]: any
    };
    /**
     * A dictionary object containing one or more computed field functions. The
     * function will be invoked once per item in the array. Each invocation
     * will receive the array item as input and must return a primitive value
     * by which the array can be sorted.
     */
    computed?: {
        [key: string]: (item: Computed) => number | string | boolean | bigint | symbol | null | undefined
    };
    /**
     * Configures whether null values will be sorted before or after defined
     * values. Set to -1 for before, 1 for after. Defaults to 1.
     * @default 1
     */
    nullRank?: -1 | 1
    /**
     * Configures whether undefined values will be sorted before or after
     * defined values. Set to -1 for before, 1 for after. Defaults to 1.
     * @default 1
     */
    undefinedRank?: -1 | 1
}

/**
 * Sort array
 * @param arr
 * @param options
 * @constructor
 */
export function SortArray<T = any>(arr: T[], ...options: SortOptions<T>[]): T[] {
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
        options.forEach((opt: SortOptions<T>): void => {
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
