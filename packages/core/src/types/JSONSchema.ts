/**
 * The type names of JSON Schema
 */
export type JSONSchemaTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

/**
 * A subschema: a schema, or a boolean schema (true accepts every value, false none)
 */
export type JSONSchemaDefinition = JSONSchema | boolean

/**
 * A JSON Schema (drafts 04 to 2020-12), or an OpenAPI 3.0/3.1 schema object (the schemas of the property maps are
 * objects: a boolean schema can be written as {} or {not: {}})
 */
export interface JSONSchema {
    $schema?: string
    $id?: string
    id?: string
    $ref?: string
    $anchor?: string
    $dynamicRef?: string
    $dynamicAnchor?: string
    $recursiveRef?: string
    $recursiveAnchor?: boolean
    $comment?: string
    $defs?: Record<string, JSONSchema>
    definitions?: Record<string, JSONSchema>
    type?: JSONSchemaTypeName | JSONSchemaTypeName[]
    enum?: unknown[]
    const?: unknown
    multipleOf?: number
    maximum?: number
    exclusiveMaximum?: number | boolean
    minimum?: number
    exclusiveMinimum?: number | boolean
    maxLength?: number
    minLength?: number
    pattern?: string
    format?: string
    contentEncoding?: string
    contentMediaType?: string
    items?: JSONSchemaDefinition | JSONSchemaDefinition[]
    prefixItems?: JSONSchemaDefinition[]
    additionalItems?: JSONSchemaDefinition
    unevaluatedItems?: JSONSchemaDefinition
    contains?: JSONSchemaDefinition
    minContains?: number
    maxContains?: number
    maxItems?: number
    minItems?: number
    uniqueItems?: boolean
    properties?: Record<string, JSONSchema>
    patternProperties?: Record<string, JSONSchema>
    additionalProperties?: JSONSchemaDefinition
    unevaluatedProperties?: JSONSchemaDefinition
    propertyNames?: JSONSchemaDefinition
    required?: string[]
    maxProperties?: number
    minProperties?: number
    dependencies?: Record<string, JSONSchema | string[]>
    dependentRequired?: Record<string, string[]>
    dependentSchemas?: Record<string, JSONSchema>
    allOf?: JSONSchemaDefinition[]
    anyOf?: JSONSchemaDefinition[]
    oneOf?: JSONSchemaDefinition[]
    not?: JSONSchemaDefinition
    if?: JSONSchemaDefinition
    then?: JSONSchemaDefinition
    else?: JSONSchemaDefinition
    title?: string
    description?: string
    default?: unknown
    examples?: unknown[]
    deprecated?: boolean
    readOnly?: boolean
    writeOnly?: boolean
    //OpenAPI 3.0
    nullable?: boolean
    example?: unknown
    //The other keywords (and the extensions)
    [keyword: string]: unknown
}
