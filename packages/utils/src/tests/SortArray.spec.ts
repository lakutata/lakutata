import {describe, it} from 'node:test'
import assert from 'node:assert'
import {inspect} from 'node:util'
import upstreamSortArray from 'sort-array'
import {SortArray, type SortOptions} from '../exports/Utils.js'

/**
 * The SortArray of 2.x, on sort-array
 * @param arr
 * @param options
 */
function UpstreamSortArray<T = any>(arr: T[], ...options: SortOptions<T>[]): T[] {
    if (options.length < 2) {
        let sortOptions: { [key: string]: any } = {order: 'asc'}
        if (options.length) sortOptions = Object.assign(sortOptions, {by: options[0].by, order: options[0].order, computed: options[0].computed})
        return (upstreamSortArray as any)(arr, sortOptions)
    }
    const sortsOptions: { [key: string]: any } = {by: [], order: [], customOrders: {}}
    options.forEach((opt: SortOptions<T>): void => {
        if (opt.by) {
            const field: string = opt.by as any
            sortsOptions.by.push(field)
            sortsOptions.order.push(field)
            sortsOptions.customOrders[field] = UpstreamSortArray(arr, opt).map((value: any): any => value[field])
        }
    })
    return (upstreamSortArray as any)(arr, sortsOptions)
}

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = Random(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

const scalar = (): unknown => pick([3, 1, 2, 10, -1, 0, 1.5, 'x', 'z', 'a', 'B', '10', '', null, undefined, NaN, true, false])

/**
 * A random array: of objects (properties of any values, missing ones) or of scalars
 */
function RandomArray(): unknown[] {
    const objects: boolean = random() < 0.6
    return Array.from({length: Math.floor(random() * 9)}, (): unknown => {
        if (!objects) return scalar()
        const item: Record<string, unknown> = {}
        for (const key of ['a', 'b', 'c']) if (random() < 0.8) item[key] = scalar()
        //Items which are not objects: reading their properties throws
        return random() < 0.2 ? pick([null, 5, 'x']) : item
    })
}

/**
 * Random options
 */
function Options(): SortOptions<any> {
    const options: Record<string, unknown> = {}
    if (random() < 0.7) options.by = pick(['a', 'b', 'c', ['a', 'b'], ['b', 'c', 'a'], 'computedA', 'missing', ''])
    if (random() < 0.7) options.order = pick(['asc', 'desc', 'custom', 'a', ['asc', 'desc'], ['desc', 'custom'], 'unknown', undefined])
    if (random() < 0.4) options.computed = pick([{computedA: (item: any): unknown => item?.a}, {a: (): number => 1}, {}])
    if (random() < 0.4) options.customOrders = {custom: ['z', 'x', 3, 1, null], a: [2, 1, 3]}
    if (random() < 0.3) options.nullRank = pick([-1, 1])
    if (random() < 0.3) options.undefinedRank = pick([-1, 1])
    return options as SortOptions<any>
}

/**
 * The sorted array, whether it is the array given, and the array given after the sort (or the error)
 * @param sort
 * @param input
 * @param options
 */
function Outcome(sort: (arr: unknown[], ...options: SortOptions<any>[]) => unknown[], input: unknown[], options: SortOptions<any>[]): string {
    const arr: unknown[] = input.slice()
    try {
        const result: unknown[] = sort(arr, ...options)
        return inspect({result: result, inPlace: result === arr, input: arr}, {depth: 4})
    } catch (error) {
        return inspect({error: (error as Error).message, input: arr}, {depth: 4})
    }
}

describe('SortArray', (): void => {

    it('sorts as the SortArray of 2.x, in place', (): void => {
        const counts: Record<string, number> = {sorted: 0, error: 0}
        for (let run: number = 0; run < 10000; run++) {
            const input: unknown[] = RandomArray()
            const options: SortOptions<any>[] = Array.from({length: pick([0, 1, 1, 1, 2, 3])}, Options)
            const expected: string = Outcome(UpstreamSortArray, input, options)
            assert.strictEqual(Outcome(SortArray, input, options), expected, `${inspect(input)} ${inspect(options, {depth: 3})}`)
            counts[expected.startsWith('{ error') ? 'error' : 'sorted']++
        }
        //The errors are rare: an invalid order compares nothing (the custom orders of a set alone are not given)
        assert.ok(counts.sorted > 5000 && counts.error > 5, JSON.stringify(counts))
    })

    it('sorts the keys of the patterns as 2.x (the identifiers of the actions)', (): void => {
        const keys: string[] = ['b', 'a', 'B', '10', '9', 'é', '_x', 'act', 'Act', 'z1', 'z10', 'z2']
        const sorted: string[] = SortArray(keys.slice(), {order: 'asc'})
        assert.deepStrictEqual(sorted, (upstreamSortArray as any)(keys.slice(), {order: 'asc'}))
    })
})
