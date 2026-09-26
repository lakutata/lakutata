/**
 * Derived from joi-to-json 5.0.0 lib/parsers/json-draft-04.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, JoiDependency, JoiSpec, JsonSchema, ParserOptions, ParserSettings} from '../model.js'
import {JoiJsonSchemaParser} from './json.js'

/**
 * Converts joi schema descriptions into JSON schemas (draft 04)
 */
export class JoiJsonDraftSchemaParser extends JoiJsonSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'http://json-schema.org/draft-04/schema#',
            logicalOpParser: {
                xor: null,
                with: function (schema: JsonSchema, dependency: JoiDependency): void {
                    schema.dependencies = schema.dependencies || {}
                    schema.dependencies[dependency.key as string] = dependency.peers
                },
                without: null
            }
        }, opts))
    }

    protected _isIfThenElseSupported(): boolean {
        return false
    }

    protected _setNumberFieldProperties(fieldSchema: JsonSchema, fieldDefn: JoiSpec): void {
        super._setNumberFieldProperties(fieldSchema, fieldDefn)
        if (typeof fieldSchema.exclusiveMinimum !== 'undefined') {
            fieldSchema.minimum = fieldSchema.exclusiveMinimum
            fieldSchema.exclusiveMinimum = true
        }
        if (typeof fieldSchema.exclusiveMaximum !== 'undefined') {
            fieldSchema.maximum = fieldSchema.exclusiveMaximum
            fieldSchema.exclusiveMaximum = true
        }
        if (typeof fieldSchema.minimum !== 'undefined' && fieldSchema.minimum === fieldSchema.exclusiveMinimum) fieldSchema.exclusiveMinimum = true
        if (typeof fieldSchema.maximum !== 'undefined' && fieldSchema.maximum === fieldSchema.exclusiveMaximum) fieldSchema.exclusiveMaximum = true
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/definitions'
    }

    protected _setArrayFieldProperties(fieldSchema: JsonSchema, fieldDefn: JoiSpec, definitions: Definitions, level: number): void {
        super._setArrayFieldProperties(fieldSchema, fieldDefn, definitions, level)
        delete fieldSchema.contains
    }

    protected _setConst(fieldSchema: JsonSchema, fieldDefn: JoiSpec): void {
        super._setConst(fieldSchema, fieldDefn)
        if (typeof fieldSchema.const !== 'undefined') {
            if (fieldSchema.const === null) {
                fieldSchema.type = 'null'
            } else if (Array.isArray(fieldSchema.const)) {
                fieldSchema.type = 'array'
            } else {
                //boolean / number / string / object
                fieldSchema.type = typeof fieldSchema.const
                if (fieldSchema.type === 'number' && Number.isInteger(fieldSchema.const)) fieldSchema.type = 'integer'
            }
            fieldSchema.enum = [fieldSchema.const]
            delete fieldSchema.const
        }
    }
}
