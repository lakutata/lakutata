/**
 * Derived from joi-to-json 5.0.0 index.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
import type {Definitions, JoiSpec, JsonSchema, Mode, ParserOptions} from './model.js'
import {JoiJsonSchemaParser} from './parsers/json.js'
import {JoiJsonDraftSchemaParser} from './parsers/json-draft-04.js'
import {JoiJsonDraftSchemaParser19} from './parsers/json-draft-2019-09.js'
import {JoiOpenApiSchemaParser} from './parsers/open-api.js'
import {JoiOpenApiThreePointOneSchemaParser} from './parsers/open-api-3.1.js'

export type * from './model.js'
export {JoiJsonSchemaParser, JoiJsonDraftSchemaParser, JoiJsonDraftSchemaParser19, JoiOpenApiSchemaParser, JoiOpenApiThreePointOneSchemaParser}

type ParserConstructor = new (opts?: ParserOptions) => JoiJsonSchemaParser

const parsers: Record<string, ParserConstructor> = {
    'json-draft-2019-09': JoiJsonDraftSchemaParser19,
    'json-draft-04': JoiJsonDraftSchemaParser,
    json: JoiJsonSchemaParser,
    'open-api': JoiOpenApiSchemaParser,
    'open-api-3.1': JoiOpenApiThreePointOneSchemaParser
}

/**
 * Convert a joi schema into a JSON schema (or an OpenAPI schema object)
 * @param joiObj the joi schema
 * @param type the output format
 * @param definitions receives the shared schemas (by id)
 * @param parserOptions
 */
export function parse(joiObj: { describe(): unknown }, type: Mode = 'json', definitions: Definitions = {}, parserOptions: ParserOptions = {}): JsonSchema {
    if (typeof joiObj.describe !== 'function') throw new Error('Not an joi object.')
    const joiBaseSpec: JoiSpec = joiObj.describe() as JoiSpec
    const parser: ParserConstructor | undefined = parsers[type]
    if (!parser) throw new Error(`No parser is registered for ${type}`)
    return new parser(parserOptions).parse(joiBaseSpec, definitions)
}

export default parse
