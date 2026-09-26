/**
 * Derived from joi-to-json 5.0.0 lib/parsers/open-api-3.1.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, JoiSpec, JsonSchema, ParserOptions} from '../model.js'
import {JoiJsonDraftSchemaParser19} from './json-draft-2019-09.js'

/**
 * Converts joi schema descriptions into OpenAPI 3.1 schema objects
 */
export class JoiOpenApiThreePointOneSchemaParser extends JoiJsonDraftSchemaParser19 {

    constructor(opts: ParserOptions = {}) {
        super(opts)
        this.$schema = undefined
    }

    public parse(joiSpec: JoiSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        const schema: JsonSchema = super.parse(joiSpec, definitions, level)
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
