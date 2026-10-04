/**
 * Derived from index.js of sort-array 5.1.1, of array-back 6.2.3 and of typical 7.3.0 (MIT, see
 * THIRD_PARTY_NOTICES.md): the sorting of 2.x, in place
 */

/**
 * How `SortArray` sorts: by which properties, in which order.
 */
export interface SortArrayOptions<Computed> {
    /**
     * The property to sort the items by, or several: the next one breaks the ties of the previous one. A name of
     * `computed` sorts by that function's result. An item whose property is `undefined` (or missing) has the key
     * `undefined` (see `undefinedRank`).
     * @default none (the items themselves are compared)
     */
    by?: string | string[]
    /**
     * The order: `'asc'`, `'desc'` or the name of a custom order of `customOrders`, or one per property of `by`. Any
     * other value leaves the items unsorted.
     * @default 'asc'
     */
    order?: string | string[]
    /**
     * Named custom orders: a name, given in `order`, mapped to the list of the values in their order
     * (`{order: 'priority', customOrders: {priority: ['high', 'medium', 'low']}}`). A value missing from the list goes
     * before the values in it.
     */
    customOrders?: { [key: string]: any }
    /**
     * Computed sort keys: a name used in `by` mapped to a function of the item returning its key. Used for an item
     * whose property of that name is `undefined`.
     */
    computed?: { [key: string]: (item: Computed) => number | string | boolean | bigint | symbol | null | undefined }
    /**
     * Where the `null` keys go, in both orders: `1` after the other values, `-1` before them.
     * @default 1
     */
    nullRank?: -1 | 1
    /**
     * Where the `undefined` keys go, in both orders: `1` after the other values, `-1` before them. An item which is
     * itself `undefined` always goes last (`Array.prototype.sort` does not compare it).
     * @default 1
     */
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
 * Sort an array in place and return it (the same array, modified). The values are compared with `<` and `>`: the
 * numbers numerically, the strings by UTF-16 code units (upper case before lower case: `'C'` before `'a'`; use
 * `localeCompare` with `Array.prototype.sort` for a human order). The `null`, `NaN` and `undefined` keys go after the
 * other values, in both orders, unless `nullRank` or `undefinedRank` puts them before.
 *
 * Without options, the items themselves are sorted ascending. With one set of options, by its `by` properties in its
 * `order`, with its `computed` keys, `customOrders`, `nullRank` and `undefinedRank`. With several sets, each one names
 * one property (`by`) and its order, the first set deciding first: an option set without `by` is skipped.
 * @param array The array to sort; an empty array is returned as is.
 * @param options The sort keys and orders: none, one set, or one set per property (see {@link SortArrayOptions}).
 * @returns The array itself, sorted.
 * @throws {TypeError} When sorting by a property of an item which is `null` or `undefined` (not an object).
 * @example
 * ```typescript
 * import {SortArray} from 'lakutata/utils'
 *
 * type Person = {name: string, age: number}
 *
 * const people: Person[] = [{name: 'Bob', age: 30}, {name: 'Ada', age: 30}, {name: 'Cy', age: 20}]
 * //The oldest first, by name among the same age
 * SortArray(people, {by: ['age', 'name'], order: ['desc', 'asc']})
 * console.log(people.map((person: Person): string => person.name))
 * //['Ada', 'Bob', 'Cy']
 * //A computed key: the length of the name
 * SortArray(people, {by: 'length', computed: {length: (person: Person): number => person.name.length}})
 * console.log(people.map((person: Person): string => person.name))
 * //['Cy', 'Ada', 'Bob']
 * console.log(SortArray([3, null, 1, 2]))
 * //[1, 2, 3, null]
 * ```
 */
export function SortArray<T = any>(array: T[], ...options: SortArrayOptions<T>[]): T[] {
    if (options.length < 2) {
        const sortOptions: { [key: string]: any } = {order: 'asc'}
        //The options given, the defaults of the sort kept for the others
        if (options.length) {
            for (const key of ['by', 'order', 'computed', 'customOrders', 'nullRank', 'undefinedRank'] as const) {
                if (options[0][key] !== undefined) sortOptions[key] = options[0][key]
            }
        }
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
