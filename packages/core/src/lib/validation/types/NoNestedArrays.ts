/**
 * The tuple `T` when none of its items is an array, else `never`: rejects the nested arrays of schemas given to
 * `ArraySchema.items()`.
 */
export type NoNestedArrays<T extends readonly unknown[]> = Extract<
    T[number],
    readonly unknown[]
> extends never
    ? T
    : never