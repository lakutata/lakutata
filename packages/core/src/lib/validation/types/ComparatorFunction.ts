/**
 * A function telling whether two array items are duplicates (true: duplicates), given to `ArraySchema.unique()`.
 */
export type ComparatorFunction = (a: any, b: any) => boolean
