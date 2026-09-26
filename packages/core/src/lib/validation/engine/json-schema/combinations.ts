/**
 * Derived from combinations 1.0.0 index.js (MIT, see THIRD_PARTY_NOTICES.md)
 */

/**
 * The combinations of the items of an array, by increasing size (from min to the size below the array length),
 * then the array itself when max reaches its length
 * @param a
 * @param min
 * @param max
 */
export function combinations<T>(a: T[], min?: number, max?: number): T[][] {
    min = min || 1
    //Like upstream: max only decides whether the whole array (the same array, not a copy) is added
    max = (max as number) < a.length ? max : a.length
    const fn = (n: number, src: T[], got: T[], all: T[][]): void => {
        if (n == 0) {
            if (got.length > 0) all[all.length] = got
            return
        }
        for (let j: number = 0; j < src.length; j++) fn(n - 1, src.slice(j + 1), got.concat([src[j]]), all)
    }
    const all: T[][] = []
    for (let i: number = min; i < a.length; i++) fn(i, a, [], all)
    if (a.length == max) all.push(a)
    return all
}
