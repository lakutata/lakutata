/**
 * Derived from the upstream index.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import {SchemaConversionException} from '../../exceptions/SchemaConversionException.js'
import type {Definitions, SchemaSpec, JsonSchema, Mode, ParserOptions} from './model.js'
import {JsonSchemaParser} from './parsers/json.js'
import {JsonDraft04SchemaParser} from './parsers/json-draft-04.js'
import {JsonDraft201909SchemaParser} from './parsers/json-draft-2019-09.js'
import {OpenApiSchemaParser} from './parsers/open-api.js'
import {OpenApi31SchemaParser} from './parsers/open-api-3.1.js'

export type * from './model.js'
export {JsonSchemaParser, JsonDraft04SchemaParser, JsonDraft201909SchemaParser, OpenApiSchemaParser, OpenApi31SchemaParser}

type ParserConstructor = new (opts?: ParserOptions) => JsonSchemaParser

const parsers: Record<string, ParserConstructor> = {
    'json-draft-2019-09': JsonDraft201909SchemaParser,
    'json-draft-04': JsonDraft04SchemaParser,
    json: JsonSchemaParser,
    'open-api': OpenApiSchemaParser,
    'open-api-3.1': OpenApi31SchemaParser
}

/**
 * Convert a schema into a JSON schema (or an OpenAPI schema object)
 * @param schemaObj the schema
 * @param type the output format
 * @param definitions receives the shared schemas (by id)
 * @param parserOptions
 */
export function parse(schemaObj: { describe(): unknown }, type: Mode = 'json', definitions: Definitions = {}, parserOptions: ParserOptions = {}): JsonSchema {
    if (typeof schemaObj.describe !== 'function') throw new SchemaConversionException('Not a schema object.')
    const baseSpec: SchemaSpec = schemaObj.describe() as SchemaSpec
    const parser: ParserConstructor | undefined = parsers[type]
    if (!parser) throw new SchemaConversionException(`No parser is registered for ${type}`)
    return new parser(parserOptions).parse(baseSpec, definitions)
}

export default parse
