/**
 * Types of joi-to-json (derived from joi-to-json 5.0.0 index.d.ts, MIT, see THIRD_PARTY_NOTICES.md)
 */

/**
 * The output format of a conversion
 */
export type Mode = 'json' | 'open-api' | 'open-api-3.1' | 'json-draft-2019-09' | 'json-draft-04'

/**
 * A JSON schema (or OpenAPI schema object) produced by a parser
 */
export interface JsonSchema {
    type?: string | string[]
    $ref?: string
    $schema?: string
    properties?: Record<string, JsonSchema>
    patternProperties?: Record<string, JsonSchema>
    required?: string[]
    additionalProperties?: unknown
    anyOf?: JsonSchema[]
    oneOf?: JsonSchema[]
    allOf?: JsonSchema[]
    not?: JsonSchema
    if?: JsonSchema
    then?: JsonSchema | false
    else?: JsonSchema
    items?: JsonSchema
    contains?: JsonSchema
    enum?: unknown[]
    const?: unknown
    examples?: unknown[]
    example?: unknown
    dependentRequired?: Record<string, string[]>
    dependencies?: Record<string, string[]>
    nullable?: boolean

    [keyword: string]: unknown
}

/**
 * A key dependency of an object schema (and, or, with...), as described by the schema
 */
export interface SpecDependency {
    rel: string
    key: string | null
    peers: string[]

    [option: string]: unknown
}

/**
 * A condition (when() or alternatives conditional()), or an alternatives try() match, as described by the schema
 */
export interface SpecCondition {
    schema?: SchemaSpec
    ref?: unknown
    is?: SchemaSpec
    then?: SchemaSpec
    otherwise?: SchemaSpec
    switch?: SpecCondition[]

    [option: string]: unknown
}

/**
 * A rule, as described by the schema
 */
export interface SpecRule {
    name: string
    args?: Record<string, unknown>

    [modifier: string]: unknown
}

/**
 * A schema description (describe() output), as far as the parsers read it
 */
export interface SchemaSpec {
    type: string
    flags?: Record<string, unknown>
    preferences?: Record<string, unknown>
    allow?: unknown[]
    invalid?: unknown[]
    rules?: SpecRule[]
    keys?: Record<string, SchemaSpec>
    patterns?: { regex?: string, rule?: SchemaSpec, schema?: SchemaSpec }[]
    dependencies?: SpecDependency[]
    matches?: SpecCondition[]
    whens?: SpecCondition[]
    items?: SchemaSpec[]
    metas?: Record<string, unknown>[]
    shared?: SchemaSpec[]
    link?: { ref?: { type?: string, path: string[] } }
    examples?: unknown[]

    [term: string]: unknown
}

/**
 * A parser of a key dependency: sets the matching keywords of the schema (in place)
 */
export type LogicalOpParserFn = (schema: JsonSchema, dependency: SpecDependency) => void

export interface LogicalOpParserOpts {
    and?: LogicalOpParserFn | null
    nand?: LogicalOpParserFn | null
    or?: LogicalOpParserFn | null
    xor?: LogicalOpParserFn | null
    oxor?: LogicalOpParserFn | null
    with?: LogicalOpParserFn | null
    without?: LogicalOpParserFn | null
}

/**
 * The options of a parser (false: the defaults)
 */
export interface ParserSettings {
    $schema?: string
    includeSchemaDialect?: boolean
    //false: no logical operator parser
    logicalOpParser?: LogicalOpParserOpts | false
}

export type ParserOptions = false | ParserSettings

/**
 * The shared schemas collected by a conversion, by id
 */
export type Definitions = Record<string, JsonSchema>
