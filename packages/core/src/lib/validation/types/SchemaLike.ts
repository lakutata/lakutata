import {SchemaLikeWithoutArray} from './SchemaLikeWithoutArray.js'

//Generic deferral (T = any) breaks the eager circular-alias resolution
//(SchemaLike -> SchemaMap -> PartialSchemaMap -> SchemaLike) that full tsc flags.
/**
 * What the schema methods accept in place of a schema: a schema, a literal value (allowed as the only valid value), an
 * object of schemas by key (an object schema) or an array of them (alternatives).
 */
export type SchemaLike<T = any> = SchemaLikeWithoutArray<T> | object
