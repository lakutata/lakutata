/**
 * Derived from joi-to-json 5.0.0 lib/parsers/json.js (MIT, see THIRD_PARTY_NOTICES.md)
 */
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
        schema.dependentRequired = schema.dependentRequired || {}
        schema.dependentRequired[dependency.key as string] = dependency.peers
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
        this.inheritedPreferences = []
        if (settings.logicalOpParser === false) {
            this.logicalOpParser = {}
        } else {
            this.logicalOpParser = _.merge({}, LOGICAL_OP_PARSER, settings.logicalOpParser)
        }
    }

    public parse(spec: SchemaSpec, definitions: Definitions = {}, level: number = 0): JsonSchema {
        let schema: JsonSchema = {}
        const hasPreferences: boolean = this._pushInheritiedPreferences(spec)
        if (this._getPresence(spec) === 'forbidden') {
            if (hasPreferences) this._popInheritiedPreferences()
            schema.not = {}
            return schema
        }
        this._setBasicProperties(schema, spec)
        this._setNumberFieldProperties(schema, spec)
        this._setBinaryFieldProperties(schema, spec)
        this._setStringFieldProperties(schema, spec)
        this._setDateFieldProperties(schema, spec)
        this._setArrayFieldProperties(schema, spec, definitions, level)
        this._setObjectProperties(schema, spec, definitions, level)
        this._setAlternativesProperties(schema, spec, definitions, level)
        this._setConditionProperties(schema, spec, definitions, level, 'whens')
        this._setMetaProperties(schema, spec)
        this._setLinkFieldProperties(schema, spec)
        this._setConst(schema, spec)
        this._setAnyProperties(schema)
        this._addNullTypeIfNullable(schema, spec)
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
        return _.pickBy(schema, (value: unknown, key: string): boolean => knownKeys.includes(key) || this._isKnownMetaKey(key))
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

    protected _getFieldType(fieldDefn: SchemaSpec): string {
        let type: string = fieldDefn.type
        if (type === 'number' && !_.isEmpty(fieldDefn.rules) && (fieldDefn.rules as SpecRule[])[0].name === 'integer') type = 'integer'
        return type
    }

    protected _addNullTypeIfNullable(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        //This should always be the last call in parse
        if (fieldSchema.const === null) return
        const enums: unknown = _.get(fieldDefn, this.enumFieldName)
        if (Array.isArray(enums) && enums.includes(null)) {
            if (Array.isArray(fieldSchema.type)) {
                if (!fieldSchema.type.includes('null')) fieldSchema.type.push('null')
            } else if (fieldSchema.type) {
                fieldSchema.type = [fieldSchema.type, 'null']
            } else {
                fieldSchema.type = 'null'
            }
        }
    }

    protected _getFieldExample(fieldDefn: SchemaSpec): unknown {
        return _.get(fieldDefn, 'examples')
    }

    protected _getPresence(fieldDefn: SchemaSpec): unknown {
        const presence: unknown = _.get(fieldDefn, 'flags.presence')
        if (presence !== undefined) return presence
        const preferences: unknown = fieldDefn[this.optionsFieldName] || this._getInheritedPreferences()
        return _.get(preferences, 'presence')
    }

    protected _isRequired(fieldDefn: SchemaSpec): boolean {
        const presence: unknown = this._getPresence(fieldDefn)
        return presence === 'required'
    }

    protected _getDefaultValue(fieldDefn: SchemaSpec): unknown {
        return _.get(fieldDefn, 'flags.default')
    }

    protected _getEnum(fieldDefn: SchemaSpec): unknown[] | undefined {
        const enumList: unknown[] | undefined = fieldDefn[this.enumFieldName] as unknown[] | undefined
        const filteredEnumList: unknown[] | undefined = enumList ? enumList.filter((e: unknown): boolean => !isOverride(e)) : enumList
        if (fieldDefn.flags && fieldDefn.flags.only && _.size(filteredEnumList) > 1) return _.uniq(filteredEnumList)
    }

    protected _getUnknown(spec: SchemaSpec): unknown {
        const allowUnknown: unknown = _.get(spec, `flags.${this.allowUnknownFlagName}`)
        if (allowUnknown !== undefined) return allowUnknown
        const preferences: unknown = spec[this.optionsFieldName] || this._getInheritedPreferences()
        return _.get(preferences, 'allowUnknown') || false
    }

    protected _setIfNotEmpty(schema: JsonSchema, field: string, value: unknown): void {
        if (value !== null && value !== undefined) schema[field] = value
    }

    protected _setBasicProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        this._setIfNotEmpty(fieldSchema, 'type', this._getFieldType(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'examples', this._getFieldExample(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'description', this._getFieldDescription(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'default', this._getDefaultValue(fieldDefn))
        this._setIfNotEmpty(fieldSchema, 'enum', this._getEnum(fieldDefn))
        if (fieldDefn.invalid && fieldDefn.invalid.length > 0) {
            fieldSchema.not = {
                enum: fieldDefn.invalid
            }
        }
    }

    protected _setBinaryFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'binary') return
        fieldSchema.type = 'string'
        if (fieldDefn.flags && fieldDefn.flags.encoding) fieldSchema.contentEncoding = fieldDefn.flags.encoding
        fieldSchema.format = 'binary'
    }

    protected _setObjectProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number): void {
        if (schema.type !== 'object') return
        const properties: Record<string, JsonSchema> = {}
        const required: string[] = []
        schema.properties = properties
        schema.required = required
        schema.additionalProperties = this._getUnknown(spec)
        _.map(spec[this.childrenFieldName] as Record<string, SchemaSpec> | undefined, (fieldDefn: SchemaSpec, key: number | string): void => {
            const fieldSchema: JsonSchema = this.parse(fieldDefn, definitions, level + 1)
            if (this._isRequired(fieldDefn)) required.push(key as string)
            properties[key] = fieldSchema
        })
        /**
         * For dynamic key scenarios to store the pattern as key
         * and have the properties be as with other examples
         */
        if (spec.patterns) {
            _.each(spec.patterns, (patternObj: NonNullable<SchemaSpec['patterns']>[number]): void => {
                if (typeof patternObj.rule !== 'object' || typeof patternObj.regex === 'undefined') return
                properties[patternObj.regex] = this.parse(patternObj.rule, definitions, level + 1)
                schema.patternProperties = schema.patternProperties || {}
                let regexString: string = patternObj.regex
                regexString = regexString.indexOf('/') === 0 ? regexString.substring(1) : regexString
                regexString = regexString.lastIndexOf('/') > -1 ? regexString.substring(0, regexString.length - 1) : regexString
                schema.patternProperties[regexString] = properties[patternObj.regex]
            })
        }
        if (_.isEmpty(schema.required)) delete schema.required
        this._setObjectDependencies(schema, spec)
    }

    protected _setObjectDependencies(schema: JsonSchema, spec: SchemaSpec): void {
        if (!Array.isArray(spec.dependencies) || spec.dependencies.length === 0) return
        if (spec.dependencies.length === 1) {
            this._setDependencySubSchema(schema, spec.dependencies[0])
        } else {
            //Like upstream: removes the with dependencies from the description
            const withDependencies: SpecDependency[] = _.remove(spec.dependencies, (dependency: SpecDependency): boolean => {
                return dependency.rel === 'with'
            })
            const allOf: JsonSchema[] = _.compact(_.map(spec.dependencies, (dependency: SpecDependency): JsonSchema | null => {
                const subSchema: JsonSchema = this._setDependencySubSchema({}, dependency)
                if (_.isEmpty(subSchema)) return null
                return subSchema
            }))
            schema.allOf = allOf
            _.each(withDependencies, (dependency: SpecDependency): void => {
                this._setDependencySubSchema(schema, dependency)
            })
            //When the logicalOpParser is set to false
            if ((schema.allOf as JsonSchema[]).length === 0) delete schema.allOf
        }
    }

    protected _setDependencySubSchema(schema: JsonSchema, dependency: SpecDependency): JsonSchema {
        const opParser: LogicalOpParserFn | null | undefined = this.logicalOpParser[dependency.rel]
        if (typeof opParser !== 'function') return schema
        opParser(schema, dependency)
        return schema
    }

    protected _setNumberFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'number' && fieldSchema.type !== 'integer') return
        const ruleArgFieldName: string = this.ruleArgFieldName
        _.each(fieldDefn.rules, (rule: SpecRule): void => {
            const value: Record<string, unknown> = rule[ruleArgFieldName] as Record<string, unknown>
            switch (rule.name) {
                case 'max':
                    fieldSchema.maximum = value.limit
                    break
                case 'min':
                    fieldSchema.minimum = value.limit
                    break
                case 'greater':
                    fieldSchema.exclusiveMinimum = value.limit
                    fieldSchema.minimum = value.limit
                    break
                case 'less':
                    fieldSchema.exclusiveMaximum = value.limit
                    fieldSchema.maximum = value.limit
                    break
                case 'multiple':
                    fieldSchema.multipleOf = value.base
                    break
                case 'sign':
                    if ((rule.args as Record<string, unknown>).sign === 'positive') {
                        fieldSchema.exclusiveMinimum = 0
                    } else if ((rule.args as Record<string, unknown>).sign === 'negative') {
                        fieldSchema.exclusiveMaximum = 0
                    }
                    break
                default:
                    break
            }
        })
    }

    protected _setStringFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'string') return
        if (fieldDefn.flags && fieldDefn.flags.encoding) fieldSchema.contentEncoding = fieldDefn.flags.encoding
        const ruleArgFieldName: string = this.ruleArgFieldName
        _.each(fieldDefn.rules, (rule: SpecRule): void => {
            const args: Record<string, unknown> = rule[ruleArgFieldName] as Record<string, unknown>
            switch (rule.name) {
                case 'min':
                    fieldSchema.minLength = args.limit
                    break
                case 'max':
                    fieldSchema.maxLength = args.limit
                    break
                case 'email':
                    fieldSchema.format = 'email'
                    break
                case 'hostname':
                    fieldSchema.format = 'hostname'
                    break
                case 'uri':
                    fieldSchema.format = 'uri'
                    break
                case 'ip': {
                    const versions: string[] = (args.options as { version: string[] }).version
                    if (!_.isEmpty(versions)) {
                        if (versions.length === 1) {
                            fieldSchema.format = versions[0]
                        } else {
                            fieldSchema.oneOf = _.map(versions, (version: string): JsonSchema => {
                                return {
                                    format: version
                                }
                            })
                        }
                    } else {
                        fieldSchema.format = 'ipv4'
                    }
                    break
                }
                case 'pattern': {
                    let regex: string = args.regex as string
                    if (regex.indexOf('/') === 0) regex = regex.replace('/', '')
                    //Remove the trailing slash, if any (upstream guards this with an always true comparison)
                    regex = regex.replace(/\/$/, '')
                    fieldSchema.pattern = regex
                    break
                }
                case 'isoDate':
                    fieldSchema.format = 'date-time'
                    break
                case 'isoDuration':
                    fieldSchema.format = 'duration'
                    break
                case 'uuid':
                case 'guid':
                    fieldSchema.format = 'uuid'
                    break
                default:
                    break
            }
        })
    }

    protected _setArrayFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec, definitions: Definitions, level: number): void {
        if (fieldSchema.type !== 'array') return
        const ruleArgFieldName: string = this.ruleArgFieldName
        _.each(fieldDefn.rules, (rule: SpecRule): void => {
            const value: Record<string, unknown> = rule[ruleArgFieldName] as Record<string, unknown>
            switch (rule.name) {
                case 'max':
                    fieldSchema.maxItems = value.limit
                    break
                case 'min':
                    fieldSchema.minItems = value.limit
                    break
                case 'length':
                    fieldSchema.maxItems = value.limit
                    fieldSchema.minItems = value.limit
                    break
                case 'unique':
                    fieldSchema.uniqueItems = true
                    break
                case 'has':
                    fieldSchema.contains = this.parse(value.schema as SchemaSpec, definitions, level + 1)
                    break
                default:
                    break
            }
        })
        if (!fieldDefn.items) {
            fieldSchema.items = {}
            return
        }
        if (fieldDefn.items.length === 1) {
            fieldSchema.items = this.parse(fieldDefn.items[0], definitions, level + 1)
        } else {
            fieldSchema.items = {
                anyOf: _.map(fieldDefn.items, (itemSchema: SchemaSpec): JsonSchema => {
                    return this.parse(itemSchema, definitions, level + 1)
                })
            }
        }
    }

    protected _setDateFieldProperties(fieldSchema: JsonSchema, fieldDefn: SchemaSpec): void {
        if (fieldSchema.type !== 'date') return
        if (fieldDefn.flags && fieldDefn.flags.format !== 'iso') {
            fieldSchema.type = 'integer'
        } else {
            //https://datatracker.ietf.org/doc/draft-handrews-json-schema-validation
            //JSON Schema does not have date type, but use string with format.
            //However, the schema definition cannot clearly tells the date/time/date-time format
            fieldSchema.type = 'string'
            fieldSchema.format = 'date-time'
        }
    }

    protected _setAlternativesProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number): void {
        if (schema.type !== 'alternatives' || (spec.matches as SpecCondition[]).length === 0) return
        const matches: SpecCondition[] = spec.matches as SpecCondition[]
        if (matches[0].schema) {
            //try style
            let mode: 'anyOf' | 'oneOf' | 'allOf' = 'anyOf'
            if (spec.flags && spec.flags.match === 'one') {
                mode = 'oneOf'
            } else if (spec.flags && spec.flags.match === 'all') {
                mode = 'allOf'
            }
            const schemas: JsonSchema[] = _.map(matches, (match: SpecCondition): JsonSchema => {
                return this.parse(match.schema as SchemaSpec, definitions, level + 1)
            })
            schema[mode] = schemas
            if (schemas.length === 1) {
                _.merge(schema, schemas[0])
                delete schema[mode]
            }
        } else {
            this._setConditionProperties(schema, spec, definitions, level, 'matches', 'anyOf')
        }
        if (schema.type === 'alternatives') delete schema.type
    }

    protected _setConditionProperties(schema: JsonSchema, spec: SchemaSpec, definitions: Definitions, level: number, conditionFieldName: string, logicKeyword: string = 'allOf'): void {
        const conditions: SpecCondition[] | undefined = spec[conditionFieldName] as SpecCondition[] | undefined
        if (!conditions || conditions.length === 0) return
        let ifThenStyle: boolean = this._isIfThenElseSupported()
        const styleSetting: Record<string, unknown>[] = _.remove(spec.metas, (meta: Record<string, unknown>): boolean => {
            return typeof meta['if-style'] !== 'undefined'
        })
        if (ifThenStyle && styleSetting.length > 0 && styleSetting[0]['if-style'] === false) ifThenStyle = false
        if (conditions.length > 1) {
            //Multiple case
            schema[logicKeyword] = _.map(conditions, (condition: SpecCondition): JsonSchema | undefined => {
                return this._setConditionSchema(ifThenStyle, {}, condition, definitions, level + 1)
            })
        } else {
            this._setConditionSchema(ifThenStyle, schema, conditions[0], definitions, level + 1)
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
        schema.if = this.parse(conditionSpec.is as SchemaSpec, definitions, level)
        if (conditionSpec.then) schema.then = this.parse(conditionSpec.then, definitions, level)
        if (conditionSpec.otherwise) schema.else = this.parse(conditionSpec.otherwise, definitions, level)
        return schema
    }

    protected _parseSwitchCondition(ifThenStyle: boolean, schema: JsonSchema, condition: SpecCondition, definitions: Definitions, level: number): void {
        //Switch cannot be used if the condition is a schema
        //Hence, condition.ref should always exists
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
            //Simple choise between then / otherwise
            const oneOf: JsonSchema[] = schema.oneOf || []
            if (condition.then) oneOf.push(this.parse(condition.then, definitions, level + 1))
            if (condition.otherwise) oneOf.push(this.parse(condition.otherwise, definitions, level + 1))
            if (oneOf.length > 1) {
                schema.oneOf = oneOf
            } else {
                _.merge(schema, oneOf[0])
            }
        } else {
            //Before Draft 7, you can express an “if-then” conditional using the Schema Composition keywords
            //and a boolean algebra concept called “implication”.
            //A -> B(pronounced, A implies B) means that if A is true, then B must also be true.
            //It can be expressed as !A || B
            //Variations of implication can express the same things you can express with the if/then/else keywords.
            //if/then can be expressed as A -> B, if/else can be expressed as !A -> B,
            //and if/then/else can be expressed as A -> B AND !A -> C
            if (condition.is && condition.then && condition.otherwise) {
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
            }
        }
        return schema
    }

    protected _setConst(schema: JsonSchema, fieldDefn: SchemaSpec): void {
        const enumList: unknown[] | undefined = fieldDefn[this.enumFieldName] as unknown[] | undefined
        const filteredEnumList: unknown[] | undefined = enumList ? enumList.filter((e: unknown): boolean => !isOverride(e)) : enumList
        if (fieldDefn.flags && fieldDefn.flags.only && _.size(filteredEnumList) === 1) {
            schema.const = (filteredEnumList as unknown[])[0]
            delete schema.type
        }
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

    protected _setMetaProperties(schema: JsonSchema, spec: SchemaSpec): void {
        _.each(spec.metas, (m: Record<string, unknown>): void => {
            if (m.contentMediaType) schema.contentMediaType = m.contentMediaType
            if (m.format) schema.format = m.format
            if (m.title) schema.title = m.title
        })
    }

    protected _setLinkFieldProperties(schema: JsonSchema, spec: SchemaSpec): void {
        if (schema.type !== 'link') return
        if (_.get(spec, 'link.ref.type') === 'local') {
            schema.$ref = `${this._getLocalSchemaBasePath()}/${(spec.link as NonNullable<SchemaSpec['link']>).ref!.path.join('/')}`
            delete schema.type
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
     * @param key
     */
    protected _isKnownMetaKey(key: string): boolean {
        return false
    }
}
