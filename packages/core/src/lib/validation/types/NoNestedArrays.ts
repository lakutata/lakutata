export type NoNestedArrays<T extends readonly unknown[]> = Extract<
    T[number],
    readonly unknown[]
> extends never
    ? T
    : never