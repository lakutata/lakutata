import {Schema} from './Schema.js'
import {SchemaMap} from './SchemaMap.js'
import {Primitives} from './Primitives.js'

export type SchemaLikeWithoutArray<TSchema = any> = Exclude<
    Primitives | Schema<TSchema> | SchemaMap<TSchema>,
    any[]
>