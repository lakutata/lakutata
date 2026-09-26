/**
 * Derived from the upstream lib/parsers/json-draft-2019-09.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {JsonSchema, ParserOptions, ParserSettings, SpecDependency} from '../model.js'
import {JsonSchemaParser} from './json.js'

/**
 * Converts schema descriptions into JSON schemas (draft 2019-09)
 */
export class JsonDraft201909SchemaParser extends JsonSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'https://json-schema.org/draft/2019-09/schema',
            logicalOpParser: {
                with: function (schema: JsonSchema, dependency: SpecDependency): void {
                    schema.dependentRequired = schema.dependentRequired || {}
                    schema.dependentRequired[dependency.key as string] = dependency.peers
                }
            }
        }, opts))
    }

    protected _setContains(schema: JsonSchema, contains: JsonSchema, options: { min?: number, max?: number }): void {
        const part: JsonSchema = {contains}
        if (options.min !== undefined && options.min !== 1) part.minContains = options.min
        if (options.max !== undefined) part.maxContains = options.max
        this._mergeKeywords(schema, part)
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
