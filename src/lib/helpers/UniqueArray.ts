/**
 * Unique array
 * @param arr
 * @constructor
 */
export function UniqueArray<T>(arr: T[]): T[] {
    return Array.from(new Set(arr))
}
