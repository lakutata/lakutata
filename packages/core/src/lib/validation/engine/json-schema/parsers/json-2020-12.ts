/**
 * Not from upstream: JSON Schema 2020-12 (lakutata's own)
 */
import * as _ from '../helpers.js'
import type {JsonSchema, ParserOptions, ParserSettings} from '../model.js'
import {JsonDraft201909SchemaParser} from './json-draft-2019-09.js'

/**
 * Converts schema descriptions into JSON schemas (draft 2020-12)
 */
export class JsonDraft202012SchemaParser extends JsonDraft201909SchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'https://json-schema.org/draft/2020-12/schema'
        }, opts))
    }

    protected _setTuple(schema: JsonSchema, ordered: JsonSchema[], rest: JsonSchema | undefined): void {
        schema.prefixItems = ordered
        schema.items = rest === undefined ? false : rest
    }
}
