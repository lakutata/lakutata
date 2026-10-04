import {SchemaLikeWithoutArray} from './SchemaLikeWithoutArray.js'

/**
 * The type of the values validated by a `SchemaLikeWithoutArray` (`never` when it cannot be inferred).
 */
export type UnwrapSchemaLikeWithoutArray<T> = T extends SchemaLikeWithoutArray<
        infer U
    >
    ? U
    : never