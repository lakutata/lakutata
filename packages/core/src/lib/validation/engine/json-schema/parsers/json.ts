/**
 * Derived from the upstream lib/parsers/json.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import {escapeRegex} from '../../utils/index.js'
import {FLOAT_MAX, integerTypes} from '../../schema/types/number.js'
import {combinations} from '../combinations.js'
import * as _ from '../helpers.js'
import type {
    Definitions,
    SpecCondition,
    SpecDependency,
    SpecRule,
    SchemaSpec,
    JsonSchema,
    LogicalOpParserFn,
    ParserOptions,
    ParserSettings
} from '../model.js'

/**
 * Default logical operator (or/and/nand/xor/oxor) parsers
 */
const LOGICAL_OP_PARSER: Record<string, LogicalOpParserFn> = {
    or: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.anyOf = _.map(dependency.peers, (peer: string): JsonSchema => {
            return {required: [peer]}
        })
    },
    and: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.oneOf = [{required: dependency.peers}]
        schema.oneOf.push({
            allOf: _.map(dependency.peers, (peer: string): JsonSchema => {
                return {not: {required: [peer]}}
            })
        })
    },
    nand: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.not = {required: dependency.peers}
    },
    xor: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.if = {
            propertyNames: {enum: dependency.peers},
            minProperties: 2
        }
        schema.then = false
        schema.else = {
            oneOf: _.map(dependency.peers, (peer: string): JsonSchema => {
                return {required: [peer]}
            })
        }
    },
    oxor: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.oneOf = _.map(dependency.peers, (peer: string): JsonSchema => {
            return {required: [peer]}
        })
        schema.oneOf.push({
            not: {
                oneOf: _.map(combinations(dependency.peers, 1, 2), (combination: string[]): JsonSchema => {
                    return {required: combination}
                })
            }
        })
    },
    with: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.dependencies = schema.dependencies || {}
        schema.dependencies[dependency.key as string] = dependency.peers
    },
    without: function (schema: JsonSchema, dependency: SpecDependency): void {
        schema.if = {required: [dependency.key as string]}
        schema.then = {
            not: {
                anyOf: _.map(dependency.peers, (peer: string): JsonSchema => {
                    return {required: [peer]}
                })
            }
        }
    }
}

/**
 * The rules of number schemas which require integers
 */
const INTEGER_RULES: string[] = ['integer', 'port', ...Object.keys(integerTypes)]

/**
 * The rules the type setters convert, by type (the rules of the other types, and the other rules, are dropped)
 */
const CONVERTED_RULES: Record<string, string[]> = {
    any: ['allOf'],
    alternatives: ['allOf'],
    boolean: ['allOf'],
    number: ['allOf', 'min', 'max', 'greater', 'less', 'multiple', 'sign', 'port', 'float', 'double', 'integer', ...Object.keys(integerTypes)],
    bigint: ['allOf', 'min', 'max', 'greater', 'less', 'multiple', 'negative', 'positive'],
    string: ['allOf', 'min', 'max', 'length', 'format', 'email', 'hostname', 'uri', 'ip', 'pattern', 'alphanum', 'token', 'hex', 'trim', 'isoDate', 'isoDuration', 'guid', 'uuid'],
    object: ['allOf', 'min', 'max', 'length', 'keyNames'],
    array: ['allOf', 'min', 'max', 'length', 'unique', 'has', 'items', 'ordered']
}

/**
 * The schema types which no JSON value matches
 */
const NON_JSON_TYPES: string[] = ['function', 'symbol']

/**
 * The keywords which annotate a schema, without constraining the values
 */
const ANNOTATIONS: string[] = ['title', 'description', 'default', 'examples', 'example', 'deprecated', 'readOnly', 'writeOnly', '$comment']

/**
 * The keywords of a subschema, which a single schema object can only hold once
 */
const CONDITION_KEYWORDS: string[] = ['if', 'then', 'else']

/**
 * A numeric bound
 */
interface Bound {
    value: number
    exclusive: boolean
}

/**
 * A regular expression of a schema description, as a JSON Schema pattern (null: not expressible)
 */
interface Pattern {
    source: string
    flags: string
}

/**
 * Recognize the `override` representation in `describe()` output.
 *
 * `override` is a Symbol that can be used in `any().valid(…)`
 * statements, to reset the list of valid values. In `describe()` output, it
 * turns up as an object with 1 property:
 *
 * ```
 * { override: true }
 * ```
 */
function isOverride(e: unknown): boolean {
    return typeof e === 'object'
        && e !== null
        && Object.keys(e).length === 1
        && (e as { override?: unknown }).override === true
}

/**
 * Whether a value is a JSON value (lakutata's own)
 * @param value
 */
function isJsonValue(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return isFinite(value)
    if (Array.isArray(value)) return value.every(isJsonValue)
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value as object).every(isJsonValue)
    return false
}

/**
 * The literal values of a values list of a schema description (null: a reference or a template, not expressible)
 * @param values
 */
function literals(values: unknown[] | undefined): unknown[] | null {
    const result: unknown[] = []
    for (const value of values || []) {
        if (isOverride(value)) continue
        if (value !== null && typeof value === 'object') {
            const keys: string[] = Object.keys(value)
            if (keys.length === 1 && keys[0] === 'value') {
                result.push((value as { value: unknown }).value)
                continue
            }
            return null
        }
        result.push(value)
    }
    return result
}

/**
 * The number of a limit of a schema description (undefined: a reference, or not a safe number)
 * @param limit
 */
function numberLimit(limit: unknown): number | undefined {
    if (typeof limit === 'number' && isFinite(limit)) return limit
    if (typeof limit === 'bigint' && limit <= BigInt(Number.MAX_SAFE_INTEGER) && limit >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(limit)
    return undefined
}

/**
 * The tighter of a bound and a limit
 * @param bound
 * @param limit
 * @param exclusive
 * @param lower
 */
function tighter(bound: Bound | undefined, limit: unknown, exclusive: boolean, lower: boolean): Bound | undefined {
    const value: number | undefined = numberLimit(limit)
    if (value === undefined) return bound
    if (!bound || (lower ? value > bound.value : value < bound.value)) return {value, exclusive}
    if (value === bound.value && exclusive) return {value, exclusive}
    return bound
}

/**
 * The pattern of a regular expression of a schema description (null: its flags have no JSON Schema equivalent, or it
 * is not a valid Unicode regular expression, as JSON Schema patterns are)
 * @param regex
 */
function toPattern(regex: unknown): Pattern | null {
    if (typeof regex !== 'string') return null
    const match: RegExpExecArray | null = /^\/([\s\S]*)\/([a-z]*)$/.exec(regex)
    if (!match) return null
    const [, source, flags] = match
    if (/[imsgyv]/.test(flags)) return null
    try {
        new RegExp(source, 'u')
    } catch {
        return null
    }
    return {source, flags}
}

/**
 * A pattern matching the strings of a list, case-insensitively (as the insensitive flag compares them)
 * @param values
 */
function insensitivePattern(values: string[]): string {
    const alternatives: string[] = values.map((value: string): string => Array.from(value).map((character: string): string => {
        const lower: string = character.toLowerCase()
        const upper: string = character.toUpperCase()
        if (lower === upper || Array.from(lower).length !== 1 || Array.from(upper).length !== 1) return escapeRegex(character)
        return `[${escapeRegex(lower)}${escapeRegex(upper)}]`
    }).join(''))
    return `^(?:${alternatives.join('|')})$`
}

/**
 * Converts schema descriptions into JSON schemas (draft 07)
 */
export class JsonSchemaParser {

    public $schema: string | undefined

    public includeSchemaDialect: boolean

    public childrenFieldName: string

    public optionsFieldName: string

    public ruleArgFieldName: string

    public enumFieldName: string

    public allowUnknownFlagName: string

    public inheritedPreferences: Record<string, unknown>[]

    public logicalOpParser: Record<string, LogicalOpParserFn | null | undefined>

    //The keys a schema may keep (with the known meta keys), all when undefined
    public knownKeys: string[] | undefined

    //Whether the schema being converted is exact so far: nothing of it was dropped (lakutata's own)
    protected _exact: boolean = true

    //The converted schemas which are not exact: they accept more values than the schemas
    protected readonly _inexactSchemas: WeakSet<JsonSchema> = new WeakSet()

    constructor(opts: ParserOptions = {}) {
        //Like upstream: false options read as no options
        const settings: ParserSettings = opts as ParserSettings
        this.$schema = settings.$schema || 'http://json-schema.org/draft-07/schema#'
        this.includeSchemaDialect = settings.includeSchemaDialect || false
        this.childrenFieldName = this._getChildrenFieldName()
        this.optionsFieldName = this._getOptionsFieldName()
        this.ruleArgFieldName = this._getRuleArgFieldName()
        this.enumFieldName = this._getEnumFieldName()
        this.allowUnknownFlagName = this._getAllowUnknownFlagName()
        //The validation preferences the schemas are used with (lakutata's own)
        this.inheritedPreferences = settings.preferences ? [settings.preferences] : []
        if (settings.logicalOpParser === false) {
            this.logicalOpParser = {}
        } else {
            this.logicalOpParser = _.merge({}, LOGICAL_OP_PARSER, settings.logicalOpParser)
        }
    }

    public parse(spec: SchemaSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        const outer: boolean = this._exact
        this._exact = true
        const schema: JsonSchema = this._parse(spec, definitions, level)
        if (!this._exact) this._inexactSchemas.add(schema)
        this._exact = outer && this._exact
        return schema
    }

    /**
     * Whether a converted schema is exact: it accepts the values the schema accepts (without conversion), and only
     * them (lakutata's own). Formats are named after the rules, and the numbers beyond the safe integers are accepted.
     * @param schema
     */
    public isExact(schema: JsonSchema): boolean {
        return !this._inexactSchemas.has(schema)
    }

    /**
     * Marks the schema being converted as not exact: something of it has no JSON Schema equivalent and is dropped
     */
    protected _inexact(): void {
        this._exact = false
    }

    protected _parse(spec: SchemaSpec, definitions: Definitions, level: number): JsonSchema {
        let schema: JsonSchema = {}
        const hasPreferences: boolean = this._pushInheritiedPreferences(spec)
        if (this._getPresence(spec) === 'forbidden') {
            if (hasPreferences) this._popInheritiedPreferences()
            schema.not = {}
            return schema
        }
        this._checkRules(spec)
        this._setBasicProperties(schema, spec)
        this._setNumberFieldProperties(schema, spec)
        this._setBinaryFieldProperties(schema, spec)
        this._setStringFieldProperties(schema, spec)
        this._setDateFieldProperties(schema, spec)
        this._setArrayFieldProperties(schema, spec, definitions, level)
        this._setObjectProperties(schema, spec, definitions, level)
        this._setAlternativesProperties(schema, spec, definitions, level)
        this._setConditionProperties(schema, spec, definitions, level, 'whens')
        this._setAllOf(schema, spec, definitions, level)
        this._setMetaProperties(schema, spec)
        this._setLinkFieldProperties(schema, spec)
        this._setAnyProperties(schema)
        this._setNonJsonProperties(schema, spec)
        schema = this._setSingle(schema, spec)
        schema = this._setValues(schema, spec)
        if (!_.isEmpty(spec.shared)) {
            _.each(spec.shared, (sharedSchema: SchemaSpec): void => {
                this.parse(sharedSchema, definitions, level)
            })
        }
        this._copyMetasToSchema(spec, schema)
        //Last step to remove any unknown keys that are not in the JSON Schema specification or known meta keys
        schema = this._retainKnownKeys(schema)
        const schemaId: unknown = _.get(spec, 'flags.id')
        if (schemaId) {
            definitions[schemaId as string] = schema
            schema = {
                $ref: `${this._getLocalSchemaBasePath()}/${schemaId as string}`
            }
        }
        if (level === 0 && !_.isEmpty(definitions)) _.set(schema, `${this._getLocalSchemaBasePath().replace('#/', '').replace(/\//, '.')}`, definitions)
        if (this.includeSchemaDialect && level === 0 && this.$schema) schema.$schema = this.$schema
        if (hasPreferences) this._popInheritiedPreferences()
        return schema
    }

    protected _retainKnownKeys(schema: JsonSchema): JsonSchema {
        if (!this.knownKeys) return schema
        const knownKeys: string[] = this.knownKeys
        const retained: JsonSchema = _.pickBy(schema, (value: unknown, key: string): boolean => knownKeys.includes(key) || this._isKnownMetaKey(key))
        //A dropped keyword makes the schema not exact
        if (Object.keys(schema).some((key: string): boolean => !(key in retained) && !ANNOTATIONS.includes(key))) this._inexact()
        return retained
    }

    /**
     * Marks the schemas with constructs JSON Schema cannot express as not exact (the constructs the type setters do
     * not convert)
     * @param spec
     */
    protected _checkRules(spec: SchemaSpec): void {
        const converted: string[] | undefined = CONVERTED_RULES[spec.type]
        //The types JSON has no equivalent for
        if (!converted) {
            if (!['any', 'alternatives', 'link', 'function', 'symbol'].includes(spec.type)) this._inexact()
            if (spec.type === 'link' && _.get(spec, 'link.ref.type') !== 'local') this._inexact()
        }
        for (const rule of spec.rules || []) {
            if (!converted || !converted.includes(rule.name)) this._inexact()
        }
        const flags: Record<string, unknown> = spec.flags || {}
        //Values made undefined, and single values as arrays
        if (flags.empty !== undefined || flags.single) this._inexact()
        if (spec.renames || spec.externals) this._inexact()
    }

    protected _pushInheritiedPreferences(spec: SchemaSpec): boolean {
        if (spec.preferences) {
            this.inheritedPreferences.push(_.merge({}, this._getInheritedPreferences(), spec.preferences))
            return true
        }
        return false
    }

    protected _popInheritiedPreferences(): void {
        this.inheritedPreferences.pop()
    }

    protected _getInheritedPreferences(): Record<string, unknown> {
        return this.inheritedPreferences[this.inheritedPreferences.length - 1] || {}
    }

    /**
     * The preferences of a schema: its preferences merged with the inherited ones (upstream uses its preferences
     * instead of the inherited ones)
     * @param spec
     */
    protected _getPreferences(spec: SchemaSpec): Record<string, unknown> {
        const preferences: unknown = spec[this.optionsFieldName]
        return preferences ? {...this._getInheritedPreferences(), ...preferences as Record<string, unknown>} : this._getInheritedPreferences()
    }

    protected _isIfThenElseSupported(): boolean {
        return true
    }

    protected _getChildrenFieldName(): string {
        return 'keys'
    }

    protected _getOptionsFieldName(): string {
        return 'preferences'
    }

    protected _getRuleArgFieldName(): string {
        return 'args'
    }

    protected _getEnumFieldName(): string {
        return 'allow'
    }

    protected _getAllowUnknownFlagName(): string {
        return 'unknown'
    }

    protected _getLocalSchemaBasePath(): string {
        return '#/$defs'
    }

    protected _getFieldDescription(fieldDefn: SchemaSpec): unknown {
        return _.get(fieldDefn, 'flags.description')
    }

    protected _getFieldType(fieldDefn: SchemaSpec): string | undefined {
        const type: string = fieldDefn.type
        //Any integer rule makes an integer (upstream: only a first integer rule)
        if (type === 'number' && _.some(fieldDefn.rules, (rule: SpecRule): boolean => INTEGER_RULES.includes(rule.name))) return 'integer'
        //JSON has no big integers: they are integers
        if (type === 'bigint') return 'integer'
        //No JSON value is a function or a symbol
        if (NON_JSON_TYPES.includes(type)) return undefined
        return type
    }

    /**
     * Makes a schema with a null type nullable (OpenAPI 3.0), and replaces the type lists where types are lists
     * @param _fieldSchema
     * @param _fieldDefn
     */
    protected _addNullTypeIfNullable(_fieldSchema: JsonSchema, _fieldDefn: SchemaSpec): void {
        //The null type is added by _setValues() (lakutata): JSON Schema has type lists
    }

    protected _getFieldExample(fieldDefn: SchemaSpec): unknown {
        const examples: unknown = _.get(fieldDefn, 'examples')
        if (!Array.isArray(examples)) return examples
        const jsonExamples: unknown[] = examples.filter(isJsonValue)
        return jsonExamples.length ? jsonExamples : undefined
    }

    protected _getPresence(fieldDefn: SchemaSpec): unknown {
        const presence: unknown = _.get(fieldDefn, 'flags.presence')
        if (presence !== undefined) return presence
        const preferences: unknown = this._getPreferences(fieldDefn)
        return _.get(preferences, 'presence')
    }

    protected _isRequired(fieldDefn: SchemaSpec): boolean {
        const presence: unknown = this._getPresence(fieldDefn)
        return presence === 'required'
    }

    protected _getDefaultValue(fieldDefn: SchemaSpec): unknown {
        const value: unknown = _.get(fieldDefn, 'flags.default')
        //Only JSON values: not a default computed by a function, or the deep default of objects
        return isJsonValue(value) && !(value !== null && typeof value === 'object' && _.get(value, 'special') === 'deep') ? value : undefined
    }

    /**
     * Whether the unknown keys of an object are accepted (true), rejected (false), or must match a schema
     * @param spec
     */
    protected _getUnknown(spec: SchemaSpec): boolean | SchemaSpec {
        const allowUnknown: unknown = _.get(spec, `flags.${this.allowUnknownFlagName}`)
        if (allowUnknown !== undefined) return allowUnknown as boolean | SchemaSpec
        const preferences: Record<string, unknown> = this._getPreferences(spec)
        if (preferences.allowUnknown) return true
        //The stripped unknown keys are accepted (lakutata)
        const stripUnknown: unknown = preferences.stripUnknown
        return stripUnknown === true || !!(stripUnknown && (stripUnknown as { objects?: boolean }).objects)
    }

    /**
     * Whether the unknown keys of an object are stripped before its rules
     * @param spec
     */
    protected _stripsUnknown(spec: SchemaSpec): boolean {
        if (_.get(spec, `flags.${this.allowUnknownFlagName}`) !== undefined) return false
        //Without keys, the keys are not processed
        if (!spec[this.childrenFieldName] && !spec.patterns) return false
        const stripUnknown: unknown = _.get(this._getPreferences(spec), 'stripUnknown')
        return stripUnknown === true || !!(stripUnknown && (stripUnknown as { objects?: boolean }).objects)
    }

    /**
     * Whether the items of arrays which match no item schema are stripped
     * @param spec
     */
    protected _stripsArrayItems(spec: SchemaSpec): boolean {
        const stripUnknown: unknown = _.get(this._getPreferences(spec), 'stripUnknown')
        return !!(stripUnknown && typeof stripUnknown === 'object' && (stripUnknown as { arrays?: boolean }).arrays)
    }

    protected _setIfNotEmpty(schema: JsonSchema, field: string, value: unknown): void {
        if (value !== null && value !== undefined) schema[field] = value
    }

    /**
     * The tighter of a bound and a limit (a reference limit is dropped)
     * @param bound
     * @param limit
     * @param exclusive
     * @param lower
     */
    protected _bound(bound: Bound | undefined, limit: unknown, exclusive: boolean, lower: boolean): Bound | undefined {
        if (numberLimit(limit) === undefined) this._inexact()
        return tighter(bound, limit, exclusive, lower)
    }

    /**
     * Adds a keyword, or a subschema of the keyword to allOf when the schema has the keyword (lakutata)
     * @param schema
     * @param keyword
     * @param value
     */
    protected _addKeyword(schema: JsonSchema, keyword: string, value: unknown): void {
        if (schema[keyword] === undefined) {
            schema[keyword] = value
        } else {
            schema.allOf = schema.allOf || []
            schema.allOf.push({[keyword]: value})
        }
    }

    /**
     * Merges the keywords of a subschema, or adds the subschema to allOf when the keywords conflict (lakutata)
     * @param schema
     * @param part
     */
    protected _mergeKeywords(schema: JsonSchema, part: JsonSchema): void {
        const keys: string[] = Object.keys(part)
        if (!keys.length) return
        const conflicts: boolean = keys.some((key: string): boolean => schema[key] !== undefined) ||
            keys.some((key: string): boolean => CONDITION_KEYWORDS.includes(key)) && CONDITION_KEYWORDS.some((key: string): boolean => schema[key] !== undefined)
        if (!conflicts) {
            Object.assign(schema, part)
        } else if (keys.length === 1 && keys[0] === 'allOf') {
            schema.allOf = [...(schema.allOf || []), ...(part.allOf as JsonSchema[])]
        } else {
            schema.allOf = schema.allOf || []
            schema.allOf.push(part)
        }
    }

    protected _setBasicProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        this._setIfNotEmpty(fieldSchema, 'type', this._getFieldType(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'examples', this._getFieldExample(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'description', this._getFieldDescription(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'default', this._getDefaultValue(fieldDefn))
    }

    /**
     * The schema of a values list (only these values)
     * @param values
     */
    protected _getValuesSchema(values: unknown[]): JsonSchema {
        return values.length === 1 ? {const: values[0]} : {enum: values}
    }

    /**
     * Applies the valid and invalid values of a schema description (lakutata's own; upstream sets the enum of the
     * valid values, and adds null to the type): the valid values of `valid()` are the only accepted values, the
     * values of `allow()` are accepted besides the values of the schema, and the invalid values are rejected
     * @param schema
     * @param spec
     */
    protected _setValues(schema: JsonSchema, spec: SchemaSpec): JsonSchema {
        const flags: Record<string, unknown> = spec.flags || {}
        const allowed: unknown[] | null = literals(spec[this.enumFieldName] as unknown[] | undefined)
        const invalid: unknown[] | null = literals(spec.invalid)
        const annotations: JsonSchema = {}
        for (const key of Object.keys(schema)) {
            if (ANNOTATIONS.includes(key) || key.startsWith('x-')) annotations[key] = schema[key]
        }
        if (!allowed || !invalid) this._inexact()
        if (flags.only) {
            //Only the valid values (the other keywords do not apply to them)
            if (!allowed || !allowed.length) return {...annotations}
            const values: unknown[] = _.uniq(allowed)
            const strings: string[] = values.filter((value: unknown): value is string => typeof value === 'string')
            if (flags.insensitive && strings.length) {
                const others: unknown[] = values.filter((value: unknown): boolean => typeof value !== 'string')
                const insensitive: JsonSchema = {type: 'string', pattern: insensitivePattern(strings)}
                if (!others.length) return {...annotations, ...insensitive}
                return {...annotations, anyOf: [insensitive, this._getValuesSchema(others)]}
            }
            return {...annotations, ...this._getValuesSchema(values)}
        }
        if (invalid && invalid.length) this._addKeyword(schema, 'not', {enum: invalid})
        //Strings are not empty, unless allowed, or a minimum length of zero (or made undefined by empty())
        const allowsEmpty: boolean = !!allowed && allowed.includes('') ||
            _.some(spec.rules, (rule: SpecRule): boolean => rule.name === 'min' && _.get(rule, `${this.ruleArgFieldName}.limit`) === 0)
        if (schema.type === 'string' && spec.type === 'string' && !allowsEmpty && flags.empty === undefined && !this._rejectsEmpty(schema)) schema.minLength = 1
        //Values of references may be allowed
        if (!allowed) return {...annotations}
        if (!allowed.length) {
            this._addNullTypeIfNullable(schema, spec)
            return schema
        }
        //A schema without constraints accepts the allowed values
        if (Object.keys(schema).every((key: string): boolean => annotations[key] !== undefined)) return schema
        let rest: unknown[] = _.uniq(allowed)
        //The empty string is accepted by the schema without its minLength
        if (schema.type === 'string' && rest.includes('') && this._acceptsEmpty(schema)) rest = rest.filter((value: unknown): boolean => value !== '')
        //Null is added to the type
        if (rest.includes(null) && this._canAddType(schema)) {
            if (Array.isArray(schema.type)) {
                if (!schema.type.includes('null')) schema.type = [...schema.type, 'null']
            } else if (schema.type !== 'null') {
                schema.type = [schema.type as string, 'null']
            }
            rest = rest.filter((value: unknown): boolean => value !== null)
        }
        this._addNullTypeIfNullable(schema, spec)
        if (!rest.length) return schema
        //The other allowed values are accepted besides the values of the schema
        const constraints: JsonSchema = {}
        for (const key of Object.keys(schema)) {
            if (annotations[key] === undefined) constraints[key] = schema[key]
        }
        return {...annotations, anyOf: [constraints, this._getValuesSchema(rest)]}
    }

    /**
     * Arrays accepting single values also accept a value their items accept (lakutata's own)
     * @param schema
     * @param spec
     */
    protected _setSingle(schema: JsonSchema, spec: SchemaSpec): JsonSchema {
        if (spec.type !== 'array' || !_.get(spec, 'flags.single')) return schema
        const annotations: JsonSchema = {}
        const constraints: JsonSchema = {}
        for (const key of Object.keys(schema)) {
            if (ANNOTATIONS.includes(key) || key.startsWith('x-')) {
                annotations[key] = schema[key]
            } else {
                constraints[key] = schema[key]
            }
        }
        const items: unknown = schema.prefixItems || schema.items
        //The single value must also make a valid array: its items schema is looser
        const single: JsonSchema = Array.isArray(items) ? (items.length ? {anyOf: items as JsonSchema[]} : {}) : (items || {}) as JsonSchema
        return {...annotations, anyOf: [constraints, single]}
    }

    /**
     * Whether a string schema certainly accepts the empty string
     * @param schema
     */
    protected _acceptsEmpty(schema: JsonSchema): boolean {
        for (const key of Object.keys(schema)) {
            if (ANNOTATIONS.includes(key) || key.startsWith('x-') || key === 'type' || key === 'maxLength' || key === 'contentEncoding') continue
            if (key === 'minLength' && (schema.minLength as number) < 1) continue
            if (key === 'pattern' && new RegExp(schema.pattern as string, 'u').test('')) continue
            return false
        }
        return true
    }

    /**
     * Whether a string schema certainly rejects the empty string
     * @param schema
     */
    protected _rejectsEmpty(schema: JsonSchema): boolean {
        if (typeof schema.minLength === 'number' && schema.minLength >= 1) return true
        if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test('')) return true
        return typeof schema.format === 'string' && ['date', 'time', 'date-time', 'duration', 'email', 'idn-email', 'hostname', 'ipv4', 'ipv6', 'uri', 'uuid'].includes(schema.format)
    }

    /**
     * Whether null can be accepted by adding it to the type of a schema: its keywords apply to other types
     * @param schema
     */
    protected _canAddType(schema: JsonSchema): boolean {
        if (!schema.type) return false
        return !['enum', 'const', 'anyOf', 'oneOf', 'allOf', 'not', 'if', '$ref'].some((key: string): boolean => schema[key] !== undefined)
    }

    protected _setBinaryFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'binary') return
        fieldSchema.type = 'string'
        if (fieldDefn.flags && fieldDefn.flags.encoding) fieldSchema.contentEncoding = fieldDefn.flags.encoding
        this._setIfNotEmpty(fieldSchema, 'format', this._getBinaryFormat())
    }

    /**
     * The format of binary strings (JSON Schema has none: upstream sets binary)
     */
    protected _getBinaryFormat(): string | undefined {
        return undefined
    }

    protected _setObjectProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number): void {
        if (schema.type !== 'object') return
        const keys: Record<string, SchemaSpec> | undefined = spec[this.childrenFieldName] as Record<string, SchemaSpec> | undefined
        const unknown: boolean | SchemaSpec = this._getUnknown(spec)
        if (!keys && !spec.patterns) {
            //Without keys, the schema accepts every key (upstream applies the unknown keys handling)
            if (typeof unknown === 'object') schema.additionalProperties = this.parse(unknown, definitions, level + 1)
        } else {
            const properties: Record<string, JsonSchema> = {}
            const required: string[] = []
            schema.properties = properties
            _.map(keys, (fieldDefn: SchemaSpec, key: number | string): void => {
                const fieldSchema: JsonSchema = this.parse(fieldDefn, definitions, level + 1)
                if (this._isRequired(fieldDefn)) required.push(key as string)
                properties[key] = fieldSchema
            })
            if (required.length) schema.required = required
            const expressible: boolean = this._setPatternProperties(schema, spec, Object.keys(keys || {}), definitions, level)
            if (!expressible || spec.renames) {
                //Keys matched by patterns JSON Schema cannot express, and renamed keys, are accepted
                this._inexact()
                schema.additionalProperties = true
            } else if (typeof unknown === 'object') {
                schema.additionalProperties = this.parse(unknown, definitions, level + 1)
            } else {
                schema.additionalProperties = unknown
            }
        }
        _.each(spec.rules, (rule: SpecRule): void => {
            const args: Record<string, unknown> = (rule[this.ruleArgFieldName] || {}) as Record<string, unknown>
            const limit: number | undefined = numberLimit(args.limit)
            switch (rule.name) {
                case 'min':
                case 'length':
                    //The keys with defaults may be added before the rules
                    if (limit !== undefined && !_.some(Object.values(keys || {}), (key: SchemaSpec): boolean => _.get(key, 'flags.default') !== undefined)) {
                        this._addKeyword(schema, 'minProperties', limit)
                        //The stripped unknown keys are not counted
                        if (this._stripsUnknown(spec)) this._inexact()
                    } else {
                        this._inexact()
                    }
                    if (rule.name === 'min') break
                //Falls through for length
                case 'max':
                    //The unknown keys may be stripped before the rules
                    if (limit !== undefined && !this._stripsUnknown(spec)) {
                        this._addKeyword(schema, 'maxProperties', limit)
                    } else {
                        this._inexact()
                    }
                    break
                case 'keyNames': {
                    const names: JsonSchema = this.parse(args.schema as SchemaSpec, definitions, level + 1)
                    //The stripped unknown keys are not checked: only the defined keys and the keys of the patterns
                    this._setPropertyNames(schema, this._stripsUnknown(spec) ? {anyOf: [names, {not: this._knownKeys(spec)}]} : names)
                    break
                }
                default:
                    break
            }
        })
        this._setObjectDependencies(schema, spec)
    }

    /**
     * Sets the schema of the key names
     * @param schema
     * @param names
     */
    protected _setPropertyNames(schema: JsonSchema, names: JsonSchema): void {
        this._addKeyword(schema, 'propertyNames', names)
    }

    /**
     * Sets the patternProperties of the patterns of an object (lakutata's own; upstream also adds each pattern as a
     * property): like the engine, a pattern applies to the keys which are not defined keys and which no previous
     * pattern (without fallthrough) matched. Returns false when a pattern is not expressible.
     * @param schema
     * @param spec
     * @param definedKeys
     * @param definitions
     * @param level
     */
    protected _setPatternProperties(schema: JsonSchema, spec: SchemaSpec, definedKeys: string[], definitions: Definitions, level: number): boolean {
        if (!spec.patterns || !spec.patterns.length) return true
        const patternProperties: Record<string, JsonSchema> = {}
        //The previous patterns which stop the matching of the next ones
        const stops: string[] = []
        for (const patternObj of spec.patterns) {
            if (typeof patternObj.rule !== 'object' || patternObj.regex === undefined) return false
            if ((patternObj as { matches?: unknown }).matches !== undefined) return false
            const pattern: Pattern | null = toPattern(patternObj.regex)
            if (!pattern) return false
            const regex: RegExp = new RegExp(pattern.source, 'u')
            const excludedKeys: string[] = definedKeys.filter((key: string): boolean => regex.test(key))
            let source: string = pattern.source
            if (excludedKeys.length || stops.length) {
                //Backreferences would be renumbered by the groups of the other patterns
                if ([pattern.source, ...stops].some((part: string): boolean => /\\[1-9]|\\k</.test(part))) return false
                const exclusions: string = excludedKeys.length ? `(?!(?:${excludedKeys.map((key: string): string => escapeRegex(key)).join('|')})$)` : ''
                source = `^${exclusions}${stops.map((stop: string): string => `(?![\\s\\S]*?(?:${stop}))`).join('')}[\\s\\S]*?(?:${pattern.source})`
                try {
                    new RegExp(source, 'u')
                } catch {
                    return false
                }
            }
            const ruleSchema: JsonSchema = this.parse(patternObj.rule, definitions, level + 1)
            if (patternProperties[source]) {
                patternProperties[source] = {allOf: [patternProperties[source], ruleSchema]}
            } else {
                patternProperties[source] = ruleSchema
            }
            if (!(patternObj as { fallthrough?: boolean }).fallthrough) stops.push(pattern.source)
        }
        schema.patternProperties = patternProperties
        return true
    }

    /**
     * The schema of the key names an object processes (its defined keys and the keys its patterns match)
     * @param spec
     */
    protected _knownKeys(spec: SchemaSpec): JsonSchema {
        const definedKeys: string[] = Object.keys((spec[this.childrenFieldName] || {}) as object)
        const known: JsonSchema[] = definedKeys.length ? [{enum: definedKeys}] : []
        for (const patternObj of spec.patterns || []) {
            const pattern: Pattern | null = toPattern(patternObj.regex)
            //A key schema matches keys JSON Schema cannot express: any key may be known
            if (!pattern) return {}
            known.push({pattern: pattern.source})
        }
        if (!known.length) return {not: {}}
        return known.length === 1 ? known[0] : {anyOf: known}
    }

    /**
     * Whether a key is processed by an object (not stripped as an unknown key)
     * @param spec
     * @param key
     */
    protected _isKnownKey(spec: SchemaSpec, key: string): boolean {
        if (Object.hasOwn((spec[this.childrenFieldName] || {}) as object, key)) return true
        return _.some(spec.patterns, (patternObj: NonNullable<SchemaSpec['patterns']>[number]): boolean => {
            const pattern: Pattern | null = toPattern(patternObj.regex)
            return !pattern || new RegExp(pattern.source, 'u').test(key)
        })
    }

    protected _setObjectDependencies(schema: JsonSchema, spec: SchemaSpec): void {
        if (!Array.isArray(spec.dependencies) || spec.dependencies.length === 0) return
        const strips: boolean = this._stripsUnknown(spec)
        const dependencies: SpecDependency[] = spec.dependencies.filter((dependency: SpecDependency): boolean => {
            const keys: (string | null)[] = [dependency.key, ...dependency.peers]
            //Keys of nested objects have no JSON Schema equivalent, and the unknown keys are stripped before the
            //dependencies are checked
            if (keys.some((key: string | null): boolean => typeof key === 'string' && (key.includes('.') || strips && !this._isKnownKey(spec, key)))) {
                this._inexact()
                return false
            }
            return true
        })
        if (dependencies.length === 1) {
            this._mergeKeywords(schema, this._setDependencySubSchema({}, dependencies[0]))
        } else if (dependencies.length > 1) {
            //Like upstream: the with dependencies are merged, the others are all of the dependencies
            const allOf: JsonSchema[] = []
            const withDependencies: JsonSchema = {}
            for (const dependency of dependencies) {
                if (dependency.rel === 'with') {
                    this._setDependencySubSchema(withDependencies, dependency)
                    continue
                }
                const subSchema: JsonSchema = this._setDependencySubSchema({}, dependency)
                if (!_.isEmpty(subSchema)) allOf.push(subSchema)
            }
            if (allOf.length) this._mergeKeywords(schema, {allOf})
            this._mergeKeywords(schema, withDependencies)
        }
    }

    protected _setDependencySubSchema(schema: JsonSchema, dependency: SpecDependency): JsonSchema {
        const opParser: LogicalOpParserFn | null | undefined = this.logicalOpParser[dependency.rel]
        if (typeof opParser !== 'function') {
            this._inexact()
            return schema
        }
        opParser(schema, dependency)
        return schema
    }

    /**
     * The format of a number schema (JSON Schema has no number formats)
     * @param _rules
     */
    protected _getNumberFormat(_rules: SpecRule[]): string | undefined {
        return undefined
    }

    protected _setNumberFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'number' && fieldSchema.type !== 'integer') return
        const ruleArgFieldName: string = this.ruleArgFieldName
        let lower: Bound | undefined
        let upper: Bound | undefined
        const rules: SpecRule[] = fieldDefn.rules || []
        _.each(rules, (rule: SpecRule): void => {
            const value: Record<string, unknown> = (rule[ruleArgFieldName] || {}) as Record<string, unknown>
            const range: readonly [number, number] | undefined = integerTypes[rule.name]
            if (range) {
                lower = this._bound(lower, range[0], false, true)
                upper = this._bound(upper, range[1], false, false)
                return
            }
            switch (rule.name) {
                case 'max':
                    upper = this._bound(upper, value.limit, false, false)
                    break
                case 'min':
                    lower = this._bound(lower, value.limit, false, true)
                    break
                case 'greater':
                    lower = this._bound(lower, value.limit, true, true)
                    break
                case 'less':
                    upper = this._bound(upper, value.limit, true, false)
                    break
                case 'port':
                    lower = this._bound(lower, 0, false, true)
                    upper = this._bound(upper, 65535, false, false)
                    break
                case 'float':
                    lower = this._bound(lower, -FLOAT_MAX, false, true)
                    upper = this._bound(upper, FLOAT_MAX, false, false)
                    break
                case 'multiple': {
                    const base: number | undefined = numberLimit(value.base)
                    if (base !== undefined) {
                        this._addKeyword(fieldSchema, 'multipleOf', base)
                    } else {
                        this._inexact()
                    }
                    break
                }
                case 'sign':
                case 'positive':
                case 'negative': {
                    const sign: unknown = rule.name === 'sign' ? value.sign : rule.name
                    if (sign === 'positive') lower = this._bound(lower, 0, true, true)
                    if (sign === 'negative') upper = this._bound(upper, 0, true, false)
                    break
                }
                default:
                    break
            }
        })
        if (lower) fieldSchema[lower.exclusive ? 'exclusiveMinimum' : 'minimum'] = lower.value
        if (upper) fieldSchema[upper.exclusive ? 'exclusiveMaximum' : 'maximum'] = upper.value
        this._setIfNotEmpty(fieldSchema, 'format', this._getNumberFormat(rules))
    }

    protected _setStringFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'string' || fieldDefn.type !== 'string') return
        if (fieldDefn.flags && fieldDefn.flags.encoding) fieldSchema.contentEncoding = fieldDefn.flags.encoding
        const ruleArgFieldName: string = this.ruleArgFieldName
        let lower: Bound | undefined
        let upper: Bound | undefined
        const addPattern = (source: string, invert: boolean = false): void => {
            if (invert) {
                this._addKeyword(fieldSchema, 'not', {pattern: source})
            } else {
                this._addKeyword(fieldSchema, 'pattern', source)
            }
        }
        _.each(fieldDefn.rules, (rule: SpecRule): void => {
            const args: Record<string, unknown> = (rule[ruleArgFieldName] || {}) as Record<string, unknown>
            const options: Record<string, unknown> = (args.options || {}) as Record<string, unknown>
            switch (rule.name) {
                case 'min':
                case 'max':
                case 'length':
                    //Lengths in bytes have no JSON Schema equivalent
                    if (args.encoding) {
                        this._inexact()
                        break
                    }
                    if (rule.name !== 'max') lower = this._bound(lower, args.limit, false, true)
                    if (rule.name !== 'min') upper = this._bound(upper, args.limit, false, false)
                    break
                case 'format':
                    this._addKeyword(fieldSchema, 'format', args.name)
                    break
                case 'email':
                    this._addKeyword(fieldSchema, 'format', 'email')
                    break
                case 'hostname':
                    this._addKeyword(fieldSchema, 'format', 'hostname')
                    break
                case 'uri':
                    this._addKeyword(fieldSchema, 'format', options.allowRelative || options.relativeOnly ? 'uri-reference' : 'uri')
                    //The formats accept every scheme, and absolute URIs
                    if (options.scheme || options.relativeOnly) this._inexact()
                    break
                case 'ip': {
                    const versions: string[] = (options.version as string[] | undefined) || []
                    const formats: string[] = versions.length ? versions.filter((version: string): boolean => version === 'ipv4' || version === 'ipv6') : ['ipv4', 'ipv6']
                    const alternatives: JsonSchema[] = options.cidr === 'required' ? [] : formats.map((format: string): JsonSchema => ({format}))
                    //Addresses with a CIDR prefix have no format (and the other versions): a looser pattern accepts them
                    if (options.cidr !== 'forbidden' || formats.length !== (versions.length || 2)) {
                        this._inexact()
                        alternatives.push({pattern: '^[0-9a-zA-Z:.]+(?:/[0-9]{1,3})?$'})
                    }
                    if (alternatives.length === 1) {
                        this._mergeKeywords(fieldSchema, alternatives[0])
                    } else {
                        this._addKeyword(fieldSchema, 'anyOf', alternatives)
                    }
                    break
                }
                case 'pattern': {
                    const pattern: Pattern | null = toPattern(args.regex)
                    if (pattern) {
                        addPattern(pattern.source, !!options.invert)
                    } else {
                        this._inexact()
                    }
                    break
                }
                case 'alphanum':
                    addPattern('^[a-zA-Z0-9]+$')
                    break
                case 'token':
                    addPattern('^[a-zA-Z0-9_]+$')
                    break
                case 'hex':
                    addPattern(options.prefix === 'optional' ? '^(?:0[xX])?[0-9a-fA-F]+$' : options.prefix === true ? '^0[xX][0-9a-fA-F]+$' : '^[0-9a-fA-F]+$')
                    if (options.byteAligned) addPattern('^(?:[\\s\\S]{2})*$')
                    break
                case 'trim':
                    if (args.enabled !== false) addPattern('^(?:\\S(?:[\\s\\S]*\\S)?)?$')
                    break
                case 'isoDate':
                    this._addKeyword(fieldSchema, 'format', 'date-time')
                    break
                case 'isoDuration':
                    this._addKeyword(fieldSchema, 'format', 'duration')
                    break
                case 'uuid':
                case 'guid':
                    this._addKeyword(fieldSchema, 'format', 'uuid')
                    break
                default:
                    break
            }
        })
        //A minimum length of zero only allows the empty string
        if (lower && lower.value > 0) fieldSchema.minLength = lower.value
        if (upper) fieldSchema.maxLength = upper.value
    }

    /**
     * Sets the schema the items of an array contain
     * @param schema
     * @param contains
     * @param options
     */
    protected _setContains(schema: JsonSchema, contains: JsonSchema, options: { min?: number, max?: number }): void {
        const min: number = options.min === undefined ? 1 : options.min
        //Draft 07 has no count of the matching items
        if (min !== 1 || options.max !== undefined) this._inexact()
        if (min < 1) return
        this._addKeyword(schema, 'contains', contains)
    }

    /**
     * Sets the items of an array with ordered items
     * @param schema
     * @param ordered
     * @param rest the schema of the other items (undefined: no other items)
     */
    protected _setTuple(schema: JsonSchema, ordered: JsonSchema[], rest: JsonSchema | undefined): void {
        schema.items = ordered
        schema.additionalItems = rest === undefined ? false : rest
    }

    protected _setArrayFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec, definitions: Definitions, level: number): void {
        if (fieldSchema.type !== 'array') return
        const ruleArgFieldName: string = this.ruleArgFieldName
        let lower: Bound | undefined
        let upper: Bound | undefined
        _.each(fieldDefn.rules, (rule: SpecRule): void => {
            const value: Record<string, unknown> = (rule[ruleArgFieldName] || {}) as Record<string, unknown>
            switch (rule.name) {
                case 'max':
                    upper = this._bound(upper, value.limit, false, false)
                    break
                case 'min':
                    lower = this._bound(lower, value.limit, false, true)
                    break
                case 'length':
                    lower = this._bound(lower, value.limit, false, true)
                    upper = this._bound(upper, value.limit, false, false)
                    break
                case 'unique':
                    //A custom comparator may accept duplicates
                    if (typeof value.comparator !== 'function') {
                        fieldSchema.uniqueItems = true
                    } else {
                        this._inexact()
                    }
                    break
                case 'has':
                    this._setContains(fieldSchema, this.parse(value.schema as SchemaSpec, definitions, level + 1), (value.options || {}) as { min?: number, max?: number })
                    break
                default:
                    break
            }
        })
        if (lower) fieldSchema.minItems = lower.value
        if (upper) fieldSchema.maxItems = upper.value
        //The items which match no item schema may be stripped
        if (this._stripsArrayItems(fieldDefn)) {
            this._inexact()
            fieldSchema.items = {}
            return
        }
        //Required item schemas require a matching item, forbidden ones forbid them
        if (_.some([...(fieldDefn.items || []), ...((fieldDefn.ordered || []) as SchemaSpec[])], (item: SchemaSpec): boolean => this._getPresence(item) !== undefined && this._getPresence(item) !== 'optional')) this._inexact()
        let rest: JsonSchema | undefined
        if (fieldDefn.items && fieldDefn.items.length) {
            if (fieldDefn.items.length === 1) {
                rest = this.parse(fieldDefn.items[0], definitions, level + 1)
            } else {
                rest = {
                    anyOf: _.map(fieldDefn.items, (itemSchema: SchemaSpec): JsonSchema => {
                        return this.parse(itemSchema, definitions, level + 1)
                    })
                }
            }
        }
        const ordered: SchemaSpec[] | undefined = fieldDefn.ordered as SchemaSpec[] | undefined
        if (ordered && ordered.length) {
            this._setTuple(fieldSchema, ordered.map((itemSchema: SchemaSpec): JsonSchema => this.parse(itemSchema, definitions, level + 1)), rest)
        } else {
            fieldSchema.items = rest || {}
        }
    }

    protected _setDateFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'date') return
        const format: unknown = fieldDefn.flags && fieldDefn.flags.format
        if (format === 'javascript' || format === 'unix') {
            //Timestamps (unix timestamps may have decimals)
            fieldSchema.type = 'number'
        } else {
            //https://datatracker.ietf.org/doc/draft-handrews-json-schema-validation
            //JSON Schema does not have date type, but use string with format.
            //However, the schema definition cannot clearly tells the date/time/date-time format
            fieldSchema.type = 'string'
            fieldSchema.format = 'date-time'
        }
    }

    protected _setAlternativesProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number): void {
        if (schema.type !== 'alternatives') return
        delete schema.type
        if ((spec.matches as SpecCondition[]).length === 0) return
        const matches: SpecCondition[] = spec.matches as SpecCondition[]
        if (matches[0].schema) {
            //try style
            const mode: string | undefined = spec.flags && spec.flags.match as string | undefined
            const schemas: JsonSchema[] = _.map(matches, (match: SpecCondition): JsonSchema => {
                return this.parse(match.schema as SchemaSpec, definitions, level + 1)
            })
            //Negating schemas which accept more values would reject values of the schema: they are dropped
            const exact: boolean = schemas.every((converted: JsonSchema): boolean => this.isExact(converted))
            if (mode === 'none') {
                //None of the alternatives (lakutata)
                if (exact) this._mergeKeywords(schema, {not: schemas.length === 1 ? schemas[0] : {anyOf: schemas}})
            } else if (schemas.length === 1) {
                this._mergeKeywords(schema, schemas[0])
            } else {
                this._mergeKeywords(schema, {[mode === 'one' ? (exact ? 'oneOf' : 'anyOf') : mode === 'all' ? 'allOf' : 'anyOf']: schemas})
            }
        } else {
            this._setConditionProperties(schema, spec, definitions, level, 'matches', 'anyOf')
        }
    }

    protected _setConditionProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number, conditionFieldName: string, logicKeyword: string = 'allOf'): void {
        const conditions: SpecCondition[] | undefined = spec[conditionFieldName] as SpecCondition[] | undefined
        if (!conditions || conditions.length === 0) return
        //The conditions of whens are concatenated to the schema, which may replace its values and flags (not the ones of
        //a schema without constraints)
        if (conditionFieldName === 'whens' && (spec.type !== 'any' || spec.rules || spec.allow || spec.invalid)) this._inexact()
        let ifThenStyle: boolean = this._isIfThenElseSupported()
        const styleSetting: Record<string, unknown>[] = _.remove(spec.metas, (meta: Record<string, unknown>): boolean => {
            return typeof meta['if-style'] !== 'undefined'
        })
        if (ifThenStyle && styleSetting.length > 0 && styleSetting[0]['if-style'] === false) ifThenStyle = false
        if (conditions.length > 1) {
            //Multiple case
            this._mergeKeywords(schema, {
                [logicKeyword]: _.compact(_.map(conditions, (condition: SpecCondition): JsonSchema | undefined => {
                    return this._setConditionSchema(ifThenStyle, {}, condition, definitions, level + 1)
                }))
            })
        } else {
            const part: JsonSchema | undefined = this._setConditionSchema(ifThenStyle, {}, conditions[0], definitions, level + 1)
            if (part) this._mergeKeywords(schema, part)
        }
    }

    protected _setConditionSchema(ifThenStyle: boolean, schema: JsonSchema, conditionSpec: SpecCondition, definitions: Definitions, level: number): JsonSchema | undefined {
        //When "if" is not present, both "then" and "else" MUST be entirely ignored.
        //There must be either "is" or "switch"
        if (!conditionSpec.is && !conditionSpec.switch) return
        if (conditionSpec.switch) {
            this._parseSwitchCondition(ifThenStyle, schema, conditionSpec, definitions, level)
        } else {
            if (ifThenStyle) {
                this._parseIfThenElseCondition(schema, conditionSpec, definitions, level)
            } else {
                this._setConditionCompositionStyle(schema, conditionSpec, definitions, level)
            }
        }
        return schema
    }

    protected _parseIfThenElseCondition(schema: JsonSchema, conditionSpec: SpecCondition, definitions: Definitions, level: number): JsonSchema {
        //Currently, if there is reference, if-then-else style is not supported
        //To use it, the condition must be defined in parent level using schema-style is
        if (conditionSpec.ref) return this._setConditionCompositionStyle(schema, conditionSpec, definitions, level)
        const condition: JsonSchema = this.parse(conditionSpec.is as SchemaSpec, definitions, level)
        if (!this.isExact(condition)) return this._setBranches(schema, conditionSpec, definitions, level)
        schema.if = condition
        if (conditionSpec.then) schema.then = this.parse(conditionSpec.then, definitions, level)
        if (conditionSpec.otherwise) schema.else = this.parse(conditionSpec.otherwise, definitions, level)
        return schema
    }

    /**
     * Sets the branches of a condition which cannot be converted: a value matches one of them (lakutata's own)
     * @param schema
     * @param conditionSpec
     * @param definitions
     * @param level
     */
    protected _setBranches(schema: JsonSchema, conditionSpec: SpecCondition, definitions: Definitions, level: number): JsonSchema {
        this._inexact()
        //A missing branch accepts every value
        if (!conditionSpec.then || !conditionSpec.otherwise) return schema
        schema.anyOf = [this.parse(conditionSpec.then, definitions, level), this.parse(conditionSpec.otherwise, definitions, level)]
        return schema
    }

    protected _parseSwitchCondition(ifThenStyle: boolean, schema: JsonSchema, condition: SpecCondition, definitions: Definitions, level: number): void {
        //Switch cannot be used if the condition is a schema
        //Hence, condition.ref should always exists
        if (condition.ref) this._inexact()
        const anyOf: JsonSchema[] = []
        for (const switchCondition of condition.switch as SpecCondition[]) {
            if (ifThenStyle && !condition.ref) {
                const innerSchema: JsonSchema = this._parseIfThenElseCondition(
                    {}, switchCondition, definitions, level + 1)
                anyOf.push(innerSchema)
            } else {
                if (switchCondition.then) anyOf.push(this.parse(switchCondition.then, definitions, level + 1))
                if (switchCondition.otherwise) anyOf.push(this.parse(switchCondition.otherwise, definitions, level + 1))
            }
        }
        if (anyOf.length > 1) {
            schema.anyOf = anyOf
        } else {
            //A single branch is merged (upstream merged an undeclared variable here, and threw)
            _.merge(schema, anyOf[0])
        }
    }

    protected _setConditionCompositionStyle(schema: JsonSchema, condition: SpecCondition, definitions: Definitions, level: number): JsonSchema {
        if (condition.ref) {
            //If the condition is refering to other field, cannot use the `is` condition for composition
            //Simple choise between then / otherwise (anyOf: both may match, upstream uses oneOf)
            this._inexact()
            const anyOf: JsonSchema[] = schema.anyOf || []
            if (condition.then) anyOf.push(this.parse(condition.then, definitions, level + 1))
            if (condition.otherwise) anyOf.push(this.parse(condition.otherwise, definitions, level + 1))
            if (anyOf.length > 1) {
                schema.anyOf = anyOf
            } else {
                _.merge(schema, anyOf[0])
            }
        } else {
            //Before Draft 7, you can express an “if-then” conditional using the Schema Composition keywords
            //and a boolean algebra concept called “implication”.
            //A -> B(pronounced, A implies B) means that if A is true, then B must also be true.
            //It can be expressed as !A || B
            //Variations of implication can express the same things you can express with the if/then/else keywords.
            //if/then can be expressed as A -> B, if/else can be expressed as !A -> B,
            //and if/then/else can be expressed as A -> B AND !A -> C
            if (condition.is && !this.isExact(this.parse(condition.is, definitions, level + 1))) {
                this._setBranches(schema, condition, definitions, level + 1)
            } else if (condition.is && condition.then && condition.otherwise) {
                schema.allOf = [
                    {
                        anyOf: [
                            {
                                not: this.parse(condition.is, definitions, level + 1)
                            },
                            this.parse(condition.then, definitions, level + 1)
                        ]
                    },
                    {
                        anyOf: [
                            this.parse(condition.is, definitions, level + 1),
                            this.parse(condition.otherwise, definitions, level + 1)
                        ]
                    }
                ]
            } else if (condition.is && condition.then) {
                schema.anyOf = [
                    {
                        not: this.parse(condition.is, definitions, level + 1)
                    },
                    this.parse(condition.then, definitions, level + 1)
                ]
            } else if (condition.is && condition.otherwise) {
                schema.anyOf = [
                    this.parse(condition.is, definitions, level + 1),
                    this.parse(condition.otherwise, definitions, level + 1)
                ]
            }
        }
        return schema
    }

    protected _setAnyProperties(schema: JsonSchema): void {
        if (schema.type !== 'any') return
        schema.type = [
            'array',
            'boolean',
            'number',
            'object',
            'string',
            'null'
        ]
    }

    /**
     * The schemas the value must also match (lakutata)
     * @param schema
     * @param spec
     * @param definitions
     * @param level
     */
    protected _setAllOf(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number): void {
        for (const rule of spec.rules || []) {
            if (rule.name !== 'allOf') continue
            const schemas: SchemaSpec[] = _.get(rule, `${this.ruleArgFieldName}.schemas`) as SchemaSpec[]
            this._mergeKeywords(schema, {allOf: schemas.map((subschema: SchemaSpec): JsonSchema => this.parse(subschema, definitions, level + 1))})
        }
    }

    /**
     * No JSON value is a function or a symbol (lakutata)
     * @param schema
     * @param spec
     */
    protected _setNonJsonProperties(schema: JsonSchema, spec: SchemaSpec): void {
        if (!NON_JSON_TYPES.includes(spec.type)) return
        this._addKeyword(schema, 'not', {})
    }

    protected _setMetaProperties(schema: JsonSchema, spec: SchemaSpec): void {
        _.each(spec.metas, (m: Record<string, unknown>): void => {
            if (m.contentMediaType) schema.contentMediaType = m.contentMediaType
            if (m.format) schema.format = m.format
            if (m.title) schema.title = m.title
        })
    }

    protected _setLinkFieldProperties(schema: JsonSchema, spec: SchemaSpec): void {
        if (schema.type !== 'link') return
        delete schema.type
        if (_.get(spec, 'link.ref.type') === 'local') {
            schema.$ref = `${this._getLocalSchemaBasePath()}/${(spec.link as NonNullable<SchemaSpec['link']>).ref!.path.join('/')}`
        }
    }

    protected _copyMetasToSchema(spec: SchemaSpec, schema: JsonSchema): void {
        if (!_.isEmpty(spec.metas)) {
            _.each(spec.metas, (meta: Record<string, unknown>): void => {
                _.each(meta, (value: unknown, key: number | string): void => {
                    if (this._isKnownMetaKey(key as string)) schema[key] = value
                })
            })
        }
    }

    /**
     * Intended to be overridden by child parsers. By default no meta key will be is considered "known".
     * @param _key
     */
    protected _isKnownMetaKey(_key: string): boolean {
        return false
    }
}
