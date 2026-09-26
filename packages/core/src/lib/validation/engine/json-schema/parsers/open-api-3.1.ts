/**
 * Derived from the upstream lib/parsers/open-api-3.1.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, SchemaSpec, JsonSchema, ParserOptions} from '../model.js'
import {JsonDraft201909SchemaParser} from './json-draft-2019-09.js'

/**
 * Converts schema descriptions into OpenAPI 3.1 schema objects
 */
export class OpenApi31SchemaParser extends JsonDraft201909SchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(opts)
        this.$schema = undefined
    }

    public parse(spec: SchemaSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        const schema: JsonSchema = super.parse(spec, definitions, level)
        if (level === 0 && !_.isEmpty(definitions)) schema.schemas = definitions
        delete schema.components
        return schema
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/components/schemas'
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key.startsWith('x-') || key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
