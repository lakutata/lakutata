/**
 * Derived from the upstream lib/parsers/open-api-3.1.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, SchemaSpec, JsonSchema, ParserOptions, SpecRule} from '../model.js'
import {JsonDraft202012SchemaParser} from './json-2020-12.js'
import {openApiNumberFormat} from './open-api.js'

/**
 * Converts schema descriptions into OpenAPI 3.1 schema objects
 */
export class OpenApi31SchemaParser extends JsonDraft202012SchemaParser {

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

    protected _getNumberFormat(rules: SpecRule[]): string | undefined {
        return openApiNumberFormat(rules)
    }

    protected _getBinaryFormat(): string | undefined {
        return 'binary'
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/components/schemas'
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key.startsWith('x-') || key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
