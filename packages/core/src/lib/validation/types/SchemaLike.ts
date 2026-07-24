import {SchemaLikeWithoutArray} from './SchemaLikeWithoutArray.js'

//Generic deferral (T = any) breaks the eager circular-alias resolution
//(SchemaLike -> SchemaMap -> PartialSchemaMap -> SchemaLike) that full tsc flags.
export type SchemaLike<T = any> = SchemaLikeWithoutArray<T> | object
