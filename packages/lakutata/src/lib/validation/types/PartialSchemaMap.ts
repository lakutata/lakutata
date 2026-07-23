import {SchemaLike} from './SchemaLike.js'

export type PartialSchemaMap<TSchema = any> = {
    [key in keyof TSchema]?: SchemaLike | SchemaLike[];
}
