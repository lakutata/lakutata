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
 * objects: a boolean schema can be written as {} or {not: {}}). Returned by `toJsonSchema()` and `DTO.toJsonSchema()`,
 * accepted by `fromJsonSchema()` and `DTO.fromJsonSchema()`. The keywords not listed (the extensions, `x-...`) are
 * allowed as well.
 */
export interface JSONSchema {
    /**
     * The URI of the JSON Schema version (dialect) the schema is written in, like
     * `https://json-schema.org/draft/2020-12/schema`.
     */
    $schema?: string
    /**
     * The URI identifying the schema, which the references (`$ref`) of other schemas can point to (drafts 06 and
     * later).
     */
    $id?: string
    /**
     * The URI identifying the schema in draft 04 (replaced by `$id` in the later drafts).
     */
    id?: string
    /**
     * A reference to another schema, by URI or JSON pointer (`#/$defs/User`), which the value must match too.
     */
    $ref?: string
    /**
     * A plain name identifying the schema in its document, which a reference reaches as `#name` (draft 2019-09 and
     * later).
     */
    $anchor?: string
    /**
     * A reference resolved in the dynamic scope of the validation, to the `$dynamicAnchor` of the same name
     * (draft 2020-12).
     */
    $dynamicRef?: string
    /**
     * A name which the `$dynamicRef` references resolve to dynamically (draft 2020-12).
     */
    $dynamicAnchor?: string
    /**
     * A reference resolved in the dynamic scope of the validation, to the schemas marked with `$recursiveAnchor`
     * (draft 2019-09).
     */
    $recursiveRef?: string
    /**
     * Whether the schema is a target of the `$recursiveRef` references (draft 2019-09).
     */
    $recursiveAnchor?: boolean
    /**
     * A comment for the schema maintainers, ignored by the validation.
     */
    $comment?: string
    /**
     * The reusable schemas, by name, which the references reach as `#/$defs/<name>` (draft 2019-09 and later).
     */
    $defs?: Record<string, JSONSchema>
    /**
     * The reusable schemas, by name, which the references reach as `#/definitions/<name>` (drafts 04 to 07).
     */
    definitions?: Record<string, JSONSchema>
    /**
     * The type of the value, or the types it may have.
     */
    type?: JSONSchemaTypeName | JSONSchemaTypeName[]
    /**
     * The only values allowed.
     */
    enum?: unknown[]
    /**
     * The only value allowed.
     */
    const?: unknown
    /**
     * The number a numeric value must be a multiple of (greater than 0).
     */
    multipleOf?: number
    /**
     * The largest numeric value allowed (inclusive).
     */
    maximum?: number
    /**
     * The limit a numeric value must be lower than (a number from draft 06), or in draft 04 and OpenAPI 3.0 whether
     * `maximum` is exclusive (a boolean).
     */
    exclusiveMaximum?: number | boolean
    /**
     * The smallest numeric value allowed (inclusive).
     */
    minimum?: number
    /**
     * The limit a numeric value must be greater than (a number from draft 06), or in draft 04 and OpenAPI 3.0 whether
     * `minimum` is exclusive (a boolean).
     */
    exclusiveMinimum?: number | boolean
    /**
     * The maximum length of a string value, in characters (Unicode code points).
     */
    maxLength?: number
    /**
     * The minimum length of a string value, in characters (Unicode code points).
     */
    minLength?: number
    /**
     * The regular expression (ECMA 262) a string value must match, anywhere in the string unless anchored.
     */
    pattern?: string
    /**
     * The format of a string value: `date-time`, `email`, `uri`, `uuid`, `ipv4`…
     */
    format?: string
    /**
     * The encoding of the content of a string value, like `base64`.
     */
    contentEncoding?: string
    /**
     * The media type of the content of a string value, like `application/json`.
     */
    contentMediaType?: string
    /**
     * The schema of every item of an array value; an array of schemas lists the schemas of the first items (drafts 04
     * to 2019-09, replaced by `prefixItems` in draft 2020-12).
     */
    items?: JSONSchemaDefinition | JSONSchemaDefinition[]
    /**
     * The schemas of the first items of an array value, in order (draft 2020-12).
     */
    prefixItems?: JSONSchemaDefinition[]
    /**
     * The schema of the items following the ones `items` lists as an array (drafts 04 to 2019-09).
     */
    additionalItems?: JSONSchemaDefinition
    /**
     * The schema of the array items no other keyword evaluated (draft 2019-09 and later).
     */
    unevaluatedItems?: JSONSchemaDefinition
    /**
     * A schema at least one item of an array value must match (`minContains` and `maxContains` change the count).
     */
    contains?: JSONSchemaDefinition
    /**
     * The minimum number of items matching `contains` (draft 2019-09 and later).
     * @default 1
     */
    minContains?: number
    /**
     * The maximum number of items matching `contains` (draft 2019-09 and later).
     */
    maxContains?: number
    /**
     * The maximum number of items of an array value.
     */
    maxItems?: number
    /**
     * The minimum number of items of an array value.
     */
    minItems?: number
    /**
     * Whether the items of an array value must all be different.
     * @default false
     */
    uniqueItems?: boolean
    /**
     * The schemas of the properties of an object value, by property name.
     */
    properties?: Record<string, JSONSchema>
    /**
     * The schemas of the properties whose name matches a regular expression, by regular expression.
     */
    patternProperties?: Record<string, JSONSchema>
    /**
     * The schema of the properties neither `properties` nor `patternProperties` list; false forbids them.
     */
    additionalProperties?: JSONSchemaDefinition
    /**
     * The schema of the properties no other keyword evaluated (draft 2019-09 and later).
     */
    unevaluatedProperties?: JSONSchemaDefinition
    /**
     * The schema every property name of an object value must match.
     */
    propertyNames?: JSONSchemaDefinition
    /**
     * The names of the properties an object value must have.
     */
    required?: string[]
    /**
     * The maximum number of properties of an object value.
     */
    maxProperties?: number
    /**
     * The minimum number of properties of an object value.
     */
    minProperties?: number
    /**
     * By property name: when the property is present, the properties listed must be too, or the object must match
     * the schema (drafts 04 to 07, split into `dependentRequired` and `dependentSchemas` in draft 2019-09).
     */
    dependencies?: Record<string, JSONSchema | string[]>
    /**
     * By property name: the properties an object value must have when it has that property (draft 2019-09 and later).
     */
    dependentRequired?: Record<string, string[]>
    /**
     * By property name: the schema an object value must match when it has that property (draft 2019-09 and later).
     */
    dependentSchemas?: Record<string, JSONSchema>
    /**
     * The schemas the value must all match.
     */
    allOf?: JSONSchemaDefinition[]
    /**
     * The schemas the value must match at least one of.
     */
    anyOf?: JSONSchemaDefinition[]
    /**
     * The schemas the value must match exactly one of.
     */
    oneOf?: JSONSchemaDefinition[]
    /**
     * A schema the value must not match.
     */
    not?: JSONSchemaDefinition
    /**
     * A condition: a value matching it must match `then`, the others `else` (draft 07 and later).
     */
    if?: JSONSchemaDefinition
    /**
     * The schema a value matching `if` must match.
     */
    then?: JSONSchemaDefinition
    /**
     * The schema a value not matching `if` must match.
     */
    else?: JSONSchemaDefinition
    /**
     * A short title of the value, for documentation.
     */
    title?: string
    /**
     * A description of the value, for documentation.
     */
    description?: string
    /**
     * The value used when it is missing (a schema imported by `fromJsonSchema()` applies it).
     */
    default?: unknown
    /**
     * Example values, for documentation.
     */
    examples?: unknown[]
    /**
     * Whether the value should not be used any more (draft 2019-09 and later, OpenAPI).
     * @default false
     */
    deprecated?: boolean
    /**
     * Whether the value is managed by its owner and is ignored when sent to it.
     * @default false
     */
    readOnly?: boolean
    /**
     * Whether the value is only sent to its owner and never returned by it (a password).
     * @default false
     */
    writeOnly?: boolean
    //OpenAPI 3.0
    /**
     * Whether the value may be null as well as of its `type` (OpenAPI 3.0; the later versions add `null` to `type`).
     * @default false
     */
    nullable?: boolean
    /**
     * An example value, for documentation (OpenAPI).
     */
    example?: unknown
    //The other keywords (and the extensions)
    [keyword: string]: unknown
}
