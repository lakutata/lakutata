/**
 * Derived from the upstream lib/parsers/json-draft-2019-09.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {ParserOptions, ParserSettings} from '../model.js'
import {JsonSchemaParser} from './json.js'

/**
 * Converts schema descriptions into JSON schemas (draft 2019-09)
 */
export class JsonDraft201909SchemaParser extends JsonSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'https://json-schema.org/draft/2019-09/schema'
        }, opts))
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
