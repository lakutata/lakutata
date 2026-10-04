import {Schema} from './Schema.js'

/**
 * A function receiving a schema and returning a schema derived from it, like `(schema) => schema.required()` (used by
 * `fork()`).
 */
export type SchemaFunction = (schema: Schema) => Schema
