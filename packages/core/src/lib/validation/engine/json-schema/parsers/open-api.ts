/**
 * Derived from the upstream lib/parsers/open-api.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, SchemaSpec, JsonSchema, ParserOptions, ParserSettings} from '../model.js'
import {JsonDraft04SchemaParser} from './json-draft-04.js'

/**
 * Converts schema descriptions into OpenAPI 3.0 schema objects
 */
export class OpenApiSchemaParser extends JsonDraft04SchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            logicalOpParser: {
                xor: null,
                with: null,
                without: null
            }
        }, opts))
        this.$schema = undefined
        this.knownKeys = [
            '$ref',
            'title',
            'multipleOf',
            'maximum',
            'exclusiveMaximum',
            'minimum',
            'exclusiveMinimum',
            'maxLength',
            'minLength',
            'pattern',
            'maxItems',
            'minItems',
            'uniqueItems',
            'maxProperties',
            'minProperties',
            'required',
            'enum',
            'description',
            'format',
            'default',
            'type',
            'allOf',
            'oneOf',
            'anyOf',
            'not',
            'items',
            'properties',
            'additionalProperties',
            'example',
            'nullable'
        ]
    }

    public parse(spec: SchemaSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        const schema: JsonSchema = super.parse(spec, definitions, level)
        if (level === 0 && !_.isEmpty(definitions)) schema.schemas = definitions
        delete schema.components
        //Unreachable, as const is not a known key (upstream reads the former fullSchema variable here)
        if (schema.const) schema.enum = [schema.const]
        return schema
    }

    protected _isIfThenElseSupported(): boolean {
        return false
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/components/schemas'
    }

    protected _setBasicProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        super._setBasicProperties(fieldSchema, fieldDefn)
        if (!_.isEmpty(fieldSchema.examples)) {
            fieldSchema.example = (fieldSchema.examples as unknown[])[0]
            delete fieldSchema.examples
        }
    }

    protected _addNullTypeIfNullable(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        super._addNullTypeIfNullable(fieldSchema, fieldDefn)
        if (fieldSchema.type === 'null') {
            //OpenAPI 3.0 does not support type with value 'null', so we need to set type to 'object' and nullable to true
            fieldSchema.type = 'object'
            fieldSchema.nullable = true
        } else if (Array.isArray(fieldSchema.type) && fieldSchema.type.includes('null')) {
            _.remove(fieldSchema.type, (i: string): boolean => {
                return i === 'null'
            })
            fieldSchema.nullable = true
            if (fieldSchema.type.length === 1) {
                fieldSchema.type = fieldSchema.type[0]
            } else if (!fieldSchema.type) {
                //Like upstream (unreachable, an array is truthy): if the only type is null, we need to set type to object
                //because open-api 3.0 does not support type with value 'null'
                fieldSchema.type = 'object'
            }
        }
        if (Array.isArray(fieldSchema.type)) {
            //anyOf is used for When / Alternative case because open-api 3.0 does not support type with array value
            const anyOf: JsonSchema[] = fieldSchema.anyOf || []
            fieldSchema.anyOf = anyOf
            _.each(fieldSchema.type, (t: string): void => {
                const typeExisted: boolean = _.some(anyOf, (condition: JsonSchema): boolean => {
                    return condition.type === t
                })
                if (!typeExisted) {
                    const def: JsonSchema = {type: t}
                    if (t === 'array') def.items = {}
                    anyOf.push(def)
                }
            })
            _.each(anyOf, (condition: JsonSchema): void => {
                if (fieldSchema.nullable) condition.nullable = true
            })
            delete fieldSchema.type
            delete fieldSchema.nullable
        }
    }

    protected _isKnownMetaKey(key: string): boolean {
        return key.startsWith('x-') || key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
    }
}
