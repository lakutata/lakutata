import {Schema} from './Schema.js'
import {SchemaMap} from './SchemaMap.js'
import {Primitives} from './Primitives.js'

/**
 * A `SchemaLike` other than an array: a schema, a primitive literal value, or an object of schemas by key.
 */
export type SchemaLikeWithoutArray<TSchema = any> = Exclude<
    Primitives | Schema<TSchema> | SchemaMap<TSchema>,
    any[]
>