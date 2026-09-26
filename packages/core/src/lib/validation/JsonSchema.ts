import type {JSONSchema} from '../../types/JSONSchema.js'
import type {Schema} from './types/Schema.js'
import type {ValidationOptions} from './interfaces/ValidationOptions.js'
import {DefaultValidationOptions} from './VLD.js'
import {SchemaConversionException} from './exceptions/SchemaConversionException.js'
import {
    JsonDraft04SchemaParser,
    JsonDraft201909SchemaParser,
    JsonDraft202012SchemaParser,
    JsonSchemaParser,
    OpenApi31SchemaParser,
    OpenApiSchemaParser
} from './engine/json-schema/index.js'
import type {Definitions, JsonSchema as ParsedSchema, SchemaSpec} from './engine/json-schema/index.js'
import {fromJsonSchema as importJsonSchema} from './engine/json-schema/import.js'

/**
 * The JSON Schema versions (and the OpenAPI schema objects) of the conversions
 */
export type JsonSchemaTarget = 'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04' | 'openapi-3.0' | 'openapi-3.1'

/**
 * The options of the conversion of a schema into a JSON Schema
 */
export interface ToJsonSchemaOptions {
    /**
     * The JSON Schema version (default: draft-2020-12)
     */
    target?: JsonSchemaTarget
    /**
     * The validation options the schema is used with: they decide which unknown keys are accepted, and the presence of
     * the keys (default: the validation options of lakutata)
     */
    preferences?: ValidationOptions
    /**
     * Whether the JSON Schema declares its version with $schema (JSON Schema versions only, default: false)
     */
    dialect?: boolean
    /**
     * Receives the shared schemas (the schemas with an id), when they are not kept in the JSON Schema
     */
    definitions?: Record<string, JSONSchema>
}

/**
 * The parsers of the versions
 */
const parsers: Record<JsonSchemaTarget, typeof JsonSchemaParser> = {
    'draft-2020-12': JsonDraft202012SchemaParser,
    'draft-2019-09': JsonDraft201909SchemaParser,
    'draft-07': JsonSchemaParser,
    'draft-04': JsonDraft04SchemaParser,
    'openapi-3.0': OpenApiSchemaParser,
    'openapi-3.1': OpenApi31SchemaParser
}

/**
 * A schema, or a DTO class (its schema)
 */
export type JsonSchemaSource = Schema | { Schema(): Schema }

/**
 * Converts a schema (or a DTO class) into a JSON Schema. The JSON Schema describes the values the schema accepts
 * without conversion: what cannot be expressed (custom rules, references to other values, conversions) is dropped, so
 * the JSON Schema may accept more values, never less. Formats are named after the rules (their implementations differ
 * on edge cases), and numbers beyond the safe integers are accepted.
 * @param source
 * @param options
 */
export function toJsonSchema(source: JsonSchemaSource, options: ToJsonSchemaOptions = {}): JSONSchema {
    const schema: unknown = typeof source === 'function' && typeof (source as { Schema?: unknown }).Schema === 'function' ? (source as { Schema(): Schema }).Schema() : source
    if (!schema || typeof (schema as { describe?: unknown }).describe !== 'function') throw new SchemaConversionException('Not a schema object.')
    const target: JsonSchemaTarget = options.target || 'draft-2020-12'
    const Parser: typeof JsonSchemaParser | undefined = parsers[target]
    if (!Parser) throw new SchemaConversionException(`Unknown JSON Schema target: ${target}`)
    const parser: JsonSchemaParser = new Parser({
        includeSchemaDialect: !!options.dialect,
        preferences: {...(options.preferences || DefaultValidationOptions)} as Record<string, unknown>
    })
    const definitions: Definitions = (options.definitions || {}) as Definitions
    const result: ParsedSchema = parser.parse((schema as { describe(): SchemaSpec }).describe(), definitions)
    return result as JSONSchema
}

/**
 * The JSON Schema versions (and the OpenAPI schema objects) a JSON Schema may be written in
 */
export type JsonSchemaDialect = JsonSchemaTarget | 'draft-06'

/**
 * The options of the conversion of a JSON Schema into a schema
 */
export interface FromJsonSchemaOptions {
    /**
     * The version of the JSON Schema (default: the version its $schema declares, else draft-2020-12)
     */
    dialect?: JsonSchemaDialect
    /**
     * The document the references are resolved in (default: the JSON Schema itself), like an OpenAPI document
     */
    document?: unknown
    /**
     * Other JSON Schemas the references may refer to, by URI (their $id, when they have one)
     */
    schemas?: Record<string, unknown>
    /**
     * Whether the values are converted, like lakutata does (default: false, like JSON Schema)
     */
    convert?: boolean
}

/**
 * Converts a JSON Schema (drafts 04 to 2020-12, or an OpenAPI 3.0/3.1 schema object) into a schema, which validates
 * like JSON Schema: without conversion, the unknown keys as the additional properties say, the formats like the full
 * formats of ajv-formats, and $ref siblings applied (like ajv). The defaults are applied.
 * @param schema
 * @param options
 */
export function fromJsonSchema(schema: JSONSchema | boolean, options: FromJsonSchemaOptions = {}): Schema {
    return importJsonSchema(schema, options) as unknown as Schema
}
