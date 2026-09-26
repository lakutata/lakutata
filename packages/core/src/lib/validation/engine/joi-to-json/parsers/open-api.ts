/**
 * Derived from joi-to-json 5.0.0 lib/parsers/open-api.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
import * as _ from '../helpers.js'
import type {Definitions, JoiSpec, JsonSchema, ParserOptions, ParserSettings} from '../model.js'
import {JoiJsonDraftSchemaParser} from './json-draft-04.js'

/**
 * Converts joi schema descriptions into OpenAPI 3.0 schema objects
 */
export class JoiOpenApiSchemaParser extends JoiJsonDraftSchemaParser {

    constructor(opts: ParserOptions = {}) {
        super(_.merge<ParserSettings>({
            logicalOpParser: {
                xor: null,
                with: null,
                without: null
            }
        }, opts))
        this.$schema = undefined
    }

    public parse(joiSpec: JoiSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        const fullSchema: JsonSchema = super.parse(joiSpec, definitions, level)
        const schema: JsonSchema = _.pickBy(fullSchema, (value: unknown, key: string): boolean => isKnownKey(key))
        if (level === 0 && !_.isEmpty(definitions)) schema.schemas = definitions
        if (fullSchema.const) schema.enum = [fullSchema.const]
        return schema
    }

    protected _isIfThenElseSupported(): boolean {
        return false
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/components/schemas'
    }

    protected _setBasicProperties(fieldSchema: JsonSchema, fieldDefn: JoiSpec): void {
        super._setBasicProperties(fieldSchema, fieldDefn)
        if (!_.isEmpty(fieldSchema.examples)) {
            fieldSchema.example = (fieldSchema.examples as unknown[])[0]
            delete fieldSchema.examples
        }
    }

    protected _addNullTypeIfNullable(fieldSchema: JsonSchema, fieldDefn: JoiSpec): void {
        super._addNullTypeIfNullable(fieldSchema, fieldDefn)
        if (fieldSchema.type === 'null') {
            delete fieldSchema.type
            fieldSchema.nullable = true
        } else if (Array.isArray(fieldSchema.type) && fieldSchema.type.includes('null')) {
            _.remove(fieldSchema.type, (i: string): boolean => {
                return i === 'null'
            })
            fieldSchema.nullable = true
            if (fieldSchema.type.length === 1) fieldSchema.type = fieldSchema.type[0]
        }
        if (Array.isArray(fieldSchema.type)) {
            //anyOf might exist for When / Alternative case
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
            delete fieldSchema.type
        }
    }

    protected _isKnownMetaKey(key: string): boolean {
        return isKnownMetaKey(key)
    }
}

function isKnownMetaKey(key: string): boolean {
    return key.startsWith('x-') || key === 'deprecated' || key === 'readOnly' || key === 'writeOnly'
}

function isKnownKey(key: string): boolean {
    const knownKeys: Set<string> = new Set([
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
    ])
    return knownKeys.has(key) || isKnownMetaKey(key)
}
