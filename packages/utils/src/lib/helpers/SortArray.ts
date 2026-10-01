//Self-implemented on Array.prototype.sort (replaces the `sort-array` package dependency).

export interface SortOptions<Computed> {
    by?: string | string[]
    order?: string | string[]
    customOrders?: { [key: string]: any }
    computed?: { [key: string]: (item: Computed) => number | string | boolean | bigint | symbol | null | undefined }
    nullRank?: -1 | 1
    undefinedRank?: -1 | 1
}

const compare = (a: any, b: any, dir: number, nullRank: number, undefRank: number): number => {
    if (a === null) return b === null ? 0 : nullRank * dir
    if (b === null) return -nullRank * dir
    if (a === undefined) return b === undefined ? 0 : undefRank * dir
    if (b === undefined) return -undefRank * dir
    if (a < b) return -dir
    if (a > b) return dir
    return 0
}

/**
 * Sort array
 * @param arr
 * @param options
 * @constructor
 */
export function SortArray<T = any>(arr: T[], ...options: SortOptions<T>[]): T[] {
    const result: T[] = [...arr]
    if (options.length < 2) {
        const opt = options[0] || {}
        const by: string[] = opt.by ? (Array.isArray(opt.by) ? opt.by : [opt.by]) : []
        const orderRaw = opt.order || 'asc'
        const orders: string[] = Array.isArray(orderRaw) ? orderRaw : [orderRaw]
        const nullRank = opt.nullRank ?? 1
        const undefRank = opt.undefinedRank ?? 1
        const dirs: number[] = by.length
            ? by.map((_, i) => (orders[i] === 'desc' ? -1 : 1))
            : [(orders[0] === 'desc' ? -1 : 1)]
        return result.sort((a: any, b: any): number => {
            for (let i = 0; i < (by.length || 1); i++) {
                const key = by[i]
                const dir = dirs[i] ?? dirs[0]
                const av = key ? (opt.computed?.[key] ? opt.computed[key](a) : a[key]) : a
                const bv = key ? (opt.computed?.[key] ? opt.computed[key](b) : b[key]) : b
                const cmp = compare(av, bv, dir, nullRank, undefRank)
                if (cmp !== 0) return cmp
            }
            return 0
        })
    } else {
        const sortsBy: string[] = []
        const sortsOrder: string[] = []
        const customOrders: Record<string, any> = {}
        options.forEach((opt: SortOptions<T>): void => {
            if (opt.by) {
                const field: string = opt.by as any
                sortsBy.push(field)
                sortsOrder.push((Array.isArray(opt.order) ? opt.order[0] : opt.order) || 'asc')
                customOrders[field] = SortArray(arr, opt).map((v: any): any => v[field])
            }
        })
        const dirs = sortsBy.map((_, i) => (sortsOrder[i] === 'desc' ? -1 : 1))
        return result.sort((a: any, b: any): number => {
            for (let i = 0; i < sortsBy.length; i++) {
                const field = sortsBy[i]
                const co = customOrders[field]
                const ai = co.indexOf(a[field])
                const bi = co.indexOf(b[field])
                const cmp = compare(ai, bi, dirs[i], 1, 1)
                if (cmp !== 0) return cmp
            }
            return 0
        })
    }
}
