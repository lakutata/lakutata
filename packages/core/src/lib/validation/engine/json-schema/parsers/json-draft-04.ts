/**
 * Derived from the upstream lib/parsers/json-draft-04.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {SpecDependency, SchemaSpec, JsonSchema, ParserOptions, ParserSettings} from '../model.js'
import {JsonSchemaParser} from './json.js'

/**
 * Converts schema descriptions into JSON schemas (draft 04)
 */
export class JsonDraft04SchemaParser extends JsonSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            $schema: 'http://json-schema.org/draft-04/schema#',
            logicalOpParser: {
                xor: null,
                with: function (schema: JsonSchema, dependency: SpecDependency): void {
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

    protected _setNumberFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
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

    protected _setContains(_schema: JsonSchema, _contains: JsonSchema, _options: { min?: number, max?: number }): void {
        //Draft 04 has no contains
        this._inexact()
    }

    protected _setPropertyNames(_schema: JsonSchema, _names: JsonSchema): void {
        //Draft 04 has no propertyNames
        this._inexact()
    }

    protected _getValuesSchema(values: unknown[]): JsonSchema {
        //Draft 04 has no const (upstream also sets the type of a single value)
        return {enum: values}
    }
}
