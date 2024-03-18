import {type PartialSchemaMap} from './PartialSchemaMap.js'
import {type StrictSchemaMap} from './StrictSchemaMap.js'

export type SchemaMap<TSchema = any, isStrict = false> = isStrict extends true ? StrictSchemaMap<TSchema> : PartialSchemaMap<TSchema>
