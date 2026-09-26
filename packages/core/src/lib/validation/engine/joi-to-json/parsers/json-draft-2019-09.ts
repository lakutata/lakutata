/**
 * Derived from joi-to-json 5.0.0 lib/parsers/json-draft-2019-09.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {ParserOptions, ParserSettings} from '../model.js'
import {JoiJsonSchemaParser} from './json.js'

/**
 * Converts joi schema descriptions into JSON schemas (draft 2019-09)
 */
export class JoiJsonDraftSchemaParser19 extends JoiJsonSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'https://json-schema.org/draft/2019-09/schema'
        }, opts))
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
