import {SchemaLikeWithoutArray} from './SchemaLikeWithoutArray.js'

export type UnwrapSchemaLikeWithoutArray<T> = T extends SchemaLikeWithoutArray<
        infer U
    >
    ? U
    : never