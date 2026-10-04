import {PartialSchemaMap} from './PartialSchemaMap.js'
import {StrictSchemaMap} from './StrictSchemaMap.js'

/**
 * The schemas of the keys of an object, by key: the argument of `DTO.Object()` and `ObjectSchema.keys()`. With
 * `isStrict`, every key of `TSchema` must have a schema of the matching type.
 */
export type SchemaMap<TSchema = any, isStrict = false> = isStrict extends true ? StrictSchemaMap<TSchema> : PartialSchemaMap<TSchema>
