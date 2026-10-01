/**
 * A schema built for a class, with the revision of the metadata of the classes it was built from
 */
export type CachedSchema<T> = {
    revision: number
    value: T
}
