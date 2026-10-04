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
    OpenApiSchemaParser,
    type Definitions,
    type JsonSchema as ParsedSchema,
    type SchemaSpec
} from './engine/json-schema/index.js'
import {fromJsonSchema as importJsonSchema} from './engine/json-schema/import.js'

/**
 * The JSON Schema versions `toJsonSchema()` writes: the JSON Schema drafts, or the schema objects of OpenAPI 3.0 and
 * 3.1.
 */
export type JsonSchemaTarget = 'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04' | 'openapi-3.0' | 'openapi-3.1'

/**
 * The options of the conversion of a schema into a JSON Schema
 */
export interface ToJsonSchemaOptions {
    /**
     * The JSON Schema version to write.
     * @default 'draft-2020-12'
     */
    target?: JsonSchemaTarget
    /**
     * The validation options the schema is used with: they decide which unknown keys are accepted
     * (`additionalProperties`) and which keys are required.
     * @default the validation options of lakutata (unknown keys allowed, keys optional)
     */
    preferences?: ValidationOptions
    /**
     * Whether the JSON Schema declares its version with `$schema` (JSON Schema versions only, not OpenAPI).
     * @default false
     */
    dialect?: boolean
    /**
     * An object receiving the shared schemas (the schemas given an id with `.id()`), by id. The JSON Schema refers to
     * them with `$ref` (`#/$defs/<id>`, `#/definitions/<id>` in draft 04, `#/components/schemas/<id>` in OpenAPI);
     * the JSON Schema versions also embed them in the root `$defs` (`definitions`). An OpenAPI schema object cannot
     * hold them: the OpenAPI targets return them in the root key `schemas` of the result as well, both to be moved by
     * the caller into the `components.schemas` of its document.
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
 * What `toJsonSchema()` converts: a schema, or a DTO class (the schema returned by its static `Schema()`).
 */
export type JsonSchemaSource = Schema | {
    /**
     * The object schema of the DTO class.
     * @returns The schema.
     */
    Schema(): Schema
}

/**
 * Converts a schema (or a DTO class) into a JSON Schema, for an API document or another validator. The JSON Schema
 * describes the values the schema accepts without conversion: what cannot be expressed (custom rules, references to
 * other values, conversions) is dropped, so the JSON Schema may accept more values, never less. The formats are named
 * after the rules (their implementations differ on edge cases), and the numbers beyond the safe integers are accepted.
 * @param source The schema, or the DTO class, to convert.
 * @param options The JSON Schema version and the validation options the schema is used with.
 * @returns A new JSON Schema.
 * @throws {SchemaConversionException} When the source is not a schema nor a DTO class, or the target is unknown.
 * @example
 * ```typescript
 * import {DTO, type JSONSchema} from 'lakutata'
 * import {toJsonSchema} from 'lakutata/dtos'
 *
 * const schema: JSONSchema = toJsonSchema(DTO.Object({
 *     name: DTO.String().max(64).required(),
 *     age: DTO.Number().integer().min(0)
 * }), {target: 'openapi-3.1'})
 * //{type: 'object', properties: {name: {type: 'string', maxLength: 64, …}, age: {type: 'integer', minimum: 0}}, required: ['name'], …}
 * console.log(schema)
 * ```
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
 * The JSON Schema versions `fromJsonSchema()` reads: the JSON Schema drafts, or the schema objects of OpenAPI 3.0 and
 * 3.1.
 */
export type JsonSchemaDialect = JsonSchemaTarget | 'draft-06'

/**
 * The options of the conversion of a JSON Schema into a schema
 */
export interface FromJsonSchemaOptions {
    /**
     * The version the JSON Schema is written in.
     * @default the version its `$schema` declares, else 'draft-2020-12'
     */
    dialect?: JsonSchemaDialect
    /**
     * The document the local references (`#/...`) are resolved in, like the OpenAPI document holding the schema
     * object.
     * @default the JSON Schema itself
     */
    document?: unknown
    /**
     * Other JSON Schemas the references may refer to, by URI (their `$id`, when they have one).
     */
    schemas?: Record<string, unknown>
    /**
     * Whether the values are converted like the schemas of lakutata do (the string `'5'` accepted as the number 5);
     * JSON Schema does not convert.
     * @default false
     */
    convert?: boolean
}

/**
 * Converts a JSON Schema (drafts 04 to 2020-12, or an OpenAPI 3.0/3.1 schema object) into a schema, which validates
 * like JSON Schema: without conversion, the unknown keys as `additionalProperties` says, the formats like the full
 * formats of ajv-formats, and the keywords next to a `$ref` applied (like ajv). The `default` values are applied.
 * @param schema The JSON Schema, or a boolean schema (true accepts every value, false none).
 * @param options The version of the JSON Schema, and where its references are resolved.
 * @returns The schema, to validate with `DTO.validate()` or to use in a DTO.
 * @throws {SchemaConversionException} When the JSON Schema is not an object nor a boolean, a reference cannot be
 * resolved, or a pattern is not a valid regular expression.
 * @example
 * ```typescript
 * import {DTO, type Schema} from 'lakutata'
 * import {fromJsonSchema} from 'lakutata/dtos'
 *
 * const schema: Schema = fromJsonSchema({
 *     type: 'object',
 *     properties: {
 *         name: {type: 'string'},
 *         age: {type: 'integer', minimum: 0, default: 18}
 *     },
 *     required: ['name']
 * })
 * console.log(DTO.validate({name: 'Ada'}, schema)) //{name: 'Ada', age: 18}
 * ```
 */
export function fromJsonSchema(schema: JSONSchema | boolean, options: FromJsonSchemaOptions = {}): Schema {
    return importJsonSchema(schema, options) as unknown as Schema
}
