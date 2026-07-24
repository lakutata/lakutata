import {PartialSchemaMap} from './PartialSchemaMap.js'
import {StrictSchemaMap} from './StrictSchemaMap.js'

export type SchemaMap<TSchema = any, isStrict = false> = isStrict extends true ? StrictSchemaMap<TSchema> : PartialSchemaMap<TSchema>
