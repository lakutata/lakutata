/**
 * Not from upstream: the conversion of JSON Schemas (drafts 04 to 2020-12) and OpenAPI 3.0/3.1 schema objects into
 * schemas (lakutata's own). The schemas validate like JSON Schema: without conversion, the unknown keys as the
 * additional properties say, the formats like the full formats of ajv-formats; the defaults are applied.
 */
import Engine from '../schema/index.js'
import type {Base} from '../schema/base.js'
import type {ValidationHelpers} from '../schema/model.js'
import type {AnySchema} from '../schema/types/any.js'
import type {ArraySchema} from '../schema/types/array.js'
import type {NumberSchema} from '../schema/types/number.js'
import type {ObjectSchema} from '../schema/types/object.js'
import type {StringSchema} from '../schema/types/string.js'
import {FLOAT_MAX, integerTypes} from '../schema/types/number.js'
import {formats} from '../schema/formats.js'
import {SchemaConversionException} from '../../exceptions/SchemaConversionException.js'

/**
 * The JSON Schema versions (and the OpenAPI schema objects) of the conversions
 */
export type ImportDialect = 'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-06' | 'draft-04' | 'openapi-3.0' | 'openapi-3.1'

/**
 * The options of the conversion of a JSON Schema into a schema
 */
export interface ImportOptions {
    /**
     * The version of the JSON Schema (default: the version its $schema declares, else draft-2020-12)
     */
    dialect?: ImportDialect
    /**
     * The document the references are resolved in (default: the JSON Schema itself), like an OpenAPI document
     */
    document?: unknown
    /**
     * Other JSON Schemas the references may refer to, by URI (their $id, when they have one)
     */
    schemas?: Record<string, unknown>
    /**
     * Whether the values are converted (default: false, like JSON Schema)
     */
    convert?: boolean
}

/**
 * A JSON Schema object
 */
type SchemaObject = Record<string, unknown>

/**
 * A JSON Schema: an object, or a boolean
 */
type SchemaNode = SchemaObject | boolean

/**
 * A resolved reference: the schema and the base URI of its resource
 */
interface Resolved {
    node: SchemaNode
    base: string
}

/**
 * The JSON types
 */
const JSON_TYPES: string[] = ['null', 'boolean', 'number', 'integer', 'string', 'array', 'object']

/**
 * The keywords of each type
 */
const TYPE_KEYWORDS: Record<string, string[]> = {
    string: ['minLength', 'maxLength', 'pattern', 'format'],
    number: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'format'],
    array: ['items', 'prefixItems', 'additionalItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems', 'uniqueItems'],
    object: ['properties', 'required', 'patternProperties', 'additionalProperties', 'propertyNames', 'minProperties', 'maxProperties', 'dependentRequired', 'dependencies']
}

/**
 * The keywords holding values, not schemas
 */
const VALUE_KEYWORDS: string[] = ['enum', 'const', 'default', 'examples', 'example']

/**
 * The URI of a JSON Schema without $id
 */
const DEFAULT_BASE: string = 'https://lakutata.invalid/schema.json'

/**
 * The dialects of the $schema URIs
 */
const DIALECTS: [RegExp, ImportDialect][] = [
    [/draft-04/, 'draft-04'],
    [/draft-06/, 'draft-06'],
    [/draft-07/, 'draft-07'],
    [/2019-09/, 'draft-2019-09'],
    [/2020-12/, 'draft-2020-12'],
    [/oas\/3\.1/, 'openapi-3.1']
]

/**
 * Whether a value is a JSON Schema object
 * @param value
 */
function isObject(value: unknown): value is SchemaObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Whether a value is a JSON Schema
 * @param value
 */
function isSchema(value: unknown): value is SchemaNode {
    return typeof value === 'boolean' || isObject(value)
}

/**
 * The URI without its fragment
 * @param uri
 */
function withoutFragment(uri: string): string {
    const index: number = uri.indexOf('#')
    return index < 0 ? uri : uri.slice(0, index)
}

/**
 * Resolves a URI reference against a base URI
 * @param reference
 * @param base
 */
function resolveUri(reference: string, base: string): string {
    try {
        return new URL(reference, base).href
    } catch {
        return reference
    }
}

/**
 * A schema which no value matches
 */
function never(): Base {
    return Engine.alternatives().try(Engine.any()).match('none')
}

/**
 * The schema of the values all the schemas accept: the first schema with the others as allOf (a schema with valid or
 * allowed values accepts them without its rules: the others are the allOf of any())
 * @param schemas
 */
function all(schemas: Base[]): Base {
    if (schemas.length === 1) return schemas[0]
    if (schemas[0]._valids) return Engine.any().allOf(...schemas)
    return (schemas[0] as AnySchema).allOf(...schemas.slice(1))
}

/**
 * The schema of JSON values (arrays are not valid() arguments: they are matched item by item)
 * @param values
 */
function literals(values: unknown[]): Base {
    const scalars: unknown[] = values.filter((value: unknown): boolean => !Array.isArray(value))
    const arrays: unknown[][] = values.filter((value: unknown): value is unknown[] => Array.isArray(value))
    const schemas: Base[] = arrays.map((value: unknown[]): Base => {
        const array: ArraySchema = Engine.array().length(value.length)
        return value.length ? array.ordered(...value.map((item: unknown): Base => literals([item]))) : array
    })
    if (scalars.length) schemas.unshift(Engine.any().valid(...scalars))
    if (!schemas.length) return never()
    return schemas.length === 1 ? schemas[0] : Engine.alternatives().try(...schemas)
}

/**
 * Converts JSON Schemas into schemas
 */
class Importer {

    protected readonly dialect: ImportDialect

    protected readonly convert: boolean

    //The schema resources and the anchors, by URI
    protected readonly registry: Map<string, Resolved> = new Map()

    //The converted schemas (the targets of references), by JSON Schema
    protected readonly converted: Map<SchemaNode, Base> = new Map()

    //The references being converted: their ids, and whether they are used (a recursion)
    protected readonly pending: Map<SchemaNode, { id: string, used: boolean }> = new Map()

    //The recursive schemas, shared by the root
    protected readonly shared: Base[] = []

    //The converted JSON Schema objects
    protected readonly memo: WeakMap<SchemaObject, Base> = new WeakMap()

    protected ids: number = 0

    constructor(protected readonly root: SchemaNode, options: ImportOptions) {
        const declared: unknown = isObject(root) ? root.$schema : undefined
        let dialect: ImportDialect | undefined = options.dialect
        if (!dialect && typeof declared === 'string') {
            dialect = DIALECTS.find(([pattern]: [RegExp, ImportDialect]): boolean => pattern.test(declared))?.[1]
        }
        this.dialect = dialect || 'draft-2020-12'
        this.convert = !!options.convert
        const document: unknown = options.document === undefined ? root : options.document
        if (isSchema(document)) this.register(document, DEFAULT_BASE)
        //The document may not be a schema (an OpenAPI document): it is its resource
        if (!isSchema(document) && document !== null && typeof document === 'object') this.registry.set(DEFAULT_BASE, {node: document as SchemaObject, base: DEFAULT_BASE})
        for (const [uri, schema] of Object.entries(options.schemas || {})) {
            if (isSchema(schema)) this.register(schema, resolveUri(uri, DEFAULT_BASE))
        }
    }

    /**
     * The schema of the root
     */
    public run(): Base {
        let schema: Base = this.node(this.root, DEFAULT_BASE)
        for (const shared of this.shared) schema = (schema as AnySchema).shared(shared)
        return schema.prefs({convert: this.convert})
    }

    /**
     * The id keyword of the version
     */
    protected get idKeyword(): string {
        return this.dialect === 'draft-04' || this.dialect === 'openapi-3.0' ? 'id' : '$id'
    }

    /**
     * Registers the resources (the schemas with an id) and the anchors of a JSON Schema
     * @param node
     * @param base
     */
    protected register(node: unknown, base: string): void {
        if (Array.isArray(node)) {
            for (const item of node) this.register(item, base)
            return
        }
        if (!isObject(node)) return
        const id: unknown = node[this.idKeyword]
        if (typeof id === 'string' && !id.startsWith('#')) {
            base = resolveUri(id, base)
            this.registry.set(withoutFragment(base), {node, base})
        }
        if (!this.registry.has(withoutFragment(base))) this.registry.set(withoutFragment(base), {node, base})
        //Anchors: $anchor and $dynamicAnchor, and the plain name fragments of the ids of the older versions
        for (const anchor of [node.$anchor, node.$dynamicAnchor, typeof id === 'string' && id.startsWith('#') ? id.slice(1) : undefined]) {
            if (typeof anchor === 'string' && anchor) this.registry.set(`${withoutFragment(base)}#${anchor}`, {node, base})
        }
        for (const [key, value] of Object.entries(node)) {
            if (VALUE_KEYWORDS.includes(key)) continue
            if (value !== null && typeof value === 'object') this.register(value, base)
        }
    }

    /**
     * Resolves a reference
     * @param reference
     * @param base
     */
    protected resolve(reference: string, base: string): Resolved {
        const uri: string = resolveUri(reference, base)
        const hashIndex: number = uri.indexOf('#')
        const fragment: string = hashIndex < 0 ? '' : decodeURIComponent(uri.slice(hashIndex + 1))
        const resource: Resolved | undefined = this.registry.get(withoutFragment(uri))
        if (!fragment.startsWith('/') && fragment) {
            const anchored: Resolved | undefined = this.registry.get(uri)
            if (anchored) return anchored
        }
        if (!resource) throw new SchemaConversionException(`Cannot resolve the reference ${reference}`)
        if (!fragment) return resource
        if (!fragment.startsWith('/')) throw new SchemaConversionException(`Cannot resolve the reference ${reference}`)
        let target: unknown = resource.node
        for (const token of fragment.slice(1).split('/')) {
            const key: string = token.replace(/~1/g, '/').replace(/~0/g, '~')
            if (target === null || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, key)) throw new SchemaConversionException(`Cannot resolve the reference ${reference}`)
            target = (target as Record<string, unknown>)[key]
        }
        if (!isSchema(target)) throw new SchemaConversionException(`The reference ${reference} is not a schema`)
        return {node: target, base: resource.base}
    }

    /**
     * The schema of a reference (a link for a recursion)
     * @param reference
     * @param base
     */
    protected reference(reference: string, base: string): Base {
        const {node, base: targetBase} = this.resolve(reference, base)
        const converted: Base | undefined = this.converted.get(node)
        if (converted) return converted
        const pending: { id: string, used: boolean } | undefined = this.pending.get(node)
        if (pending) {
            pending.used = true
            return Engine.link(`#${pending.id}`)
        }
        const id: string = `ref${++this.ids}`
        this.pending.set(node, {id, used: false})
        let schema: Base = this.node(node, targetBase)
        const {used} = this.pending.get(node)!
        this.pending.delete(node)
        if (used) {
            //A recursive schema is shared by the root, and referred to by links
            this.shared.push(schema.id(id))
            schema = Engine.link(`#${id}`)
        }
        this.converted.set(node, schema)
        return schema
    }

    /**
     * Converts a JSON Schema
     * @param node
     * @param base
     */
    protected node(node: SchemaNode, base: string): Base {
        if (node === true) return Engine.any()
        if (node === false) return never()
        if (!isObject(node)) throw new SchemaConversionException('A JSON Schema must be an object or a boolean')
        const memo: Base | undefined = this.memo.get(node)
        if (memo) return memo
        const schema: Base = this.convertNode(node, base)
        this.memo.set(node, schema)
        return schema
    }

    /**
     * Converts a JSON Schema object
     * @param node
     * @param base
     */
    protected convertNode(node: SchemaObject, base: string): Base {
        const id: unknown = node[this.idKeyword]
        if (typeof id === 'string' && !id.startsWith('#')) base = resolveUri(id, base)
        //The keywords of the node first, then the subschemas (in the order of ajv), then the references: a recursion stops
        //at a failing keyword
        const parts: Base[] = []
        const typed: Base | undefined = this.typed(node, base)
        if (typed) parts.push(typed)
        if (isSchema(node.not)) parts.push(Engine.alternatives().try(this.node(node.not, base)).match('none'))
        const anyOf: SchemaNode[] = this.list(node.anyOf)
        if (anyOf.length) parts.push(anyOf.length === 1 ? this.node(anyOf[0], base) : Engine.alternatives().try(...anyOf.map((subschema: SchemaNode): Base => this.node(subschema, base))))
        const oneOf: SchemaNode[] = this.list(node.oneOf)
        if (oneOf.length) parts.push(Engine.alternatives().try(...oneOf.map((subschema: SchemaNode): Base => this.node(subschema, base))).match('one'))
        for (const subschema of this.list(node.allOf)) parts.push(this.node(subschema, base))
        if (isSchema(node.if) && (isSchema(node.then) || isSchema(node.else))) {
            parts.push(Engine.any().when(this.node(node.if, base), {
                then: isSchema(node.then) ? this.node(node.then, base) : Engine.any(),
                otherwise: isSchema(node.else) ? this.node(node.else, base) : Engine.any()
            }))
        }
        for (const [key, dependency] of Object.entries(this.dependentSchemas(node))) {
            //The schema applies to the objects with the key
            parts.push(Engine.any().when(Engine.object({[key]: Engine.any().required()}).unknown(), {then: this.node(dependency, base), otherwise: Engine.any()}))
        }
        //The siblings of $ref apply, like ajv does in every version (JSON Schema ignores them before 2019-09)
        const reference: unknown = node.$ref ?? node.$dynamicRef ?? node.$recursiveRef
        if (typeof reference === 'string') parts.push(this.reference(reference, base))
        const unevaluated: Base | undefined = this.unevaluated(node, base)
        if (unevaluated) parts.push(unevaluated)
        let schema: Base = this.values(node, parts)
        schema = this.annotate(schema, node)
        return schema
    }

    /**
     * The schemas of a list keyword
     * @param value
     */
    protected list(value: unknown): SchemaNode[] {
        return Array.isArray(value) ? value.filter(isSchema) : []
    }

    /**
     * The dependent schemas of an object JSON Schema (dependentSchemas, and the schemas of dependencies)
     * @param node
     */
    protected dependentSchemas(node: SchemaObject): Record<string, SchemaNode> {
        const result: Record<string, SchemaNode> = {}
        for (const keyword of ['dependencies', 'dependentSchemas']) {
            const dependencies: unknown = node[keyword]
            if (!isObject(dependencies)) continue
            for (const [key, value] of Object.entries(dependencies)) {
                if (isSchema(value)) result[key] = value
            }
        }
        return result
    }

    /**
     * The schema of the values a JSON Schema accepts: its enum (or const) values which match its other keywords, or
     * all its keywords
     * @param node
     * @param parts
     */
    protected values(node: SchemaObject, parts: Base[]): Base {
        let values: unknown[] | undefined
        if (Array.isArray(node.enum)) values = node.enum
        if (Object.prototype.hasOwnProperty.call(node, 'const')) values = values ? values.filter((value: unknown): boolean => literals([node.const]).validate(value).error === undefined) : [node.const]
        const combined: Base | undefined = parts.length === 0 ? undefined : all(parts)
        if (!values) return combined || Engine.any()
        if (!values.length) return never()
        if (!combined) return literals(values)
        try {
            //The values are constants: the ones the other keywords reject are dropped
            return literals(values.filter((value: unknown): boolean => combined.validate(value, {convert: this.convert}).error === undefined))
        } catch {
            //A link which cannot be resolved yet
            return all([literals(values), combined])
        }
    }

    /**
     * The schema of the types of a JSON Schema, with the keywords of each type (undefined: no type constraint)
     * @param node
     * @param base
     */
    protected typed(node: SchemaObject, base: string): Base | undefined {
        let types: string[] | undefined = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type.filter((type: unknown): type is string => typeof type === 'string') : undefined
        if (types && this.dialect === 'openapi-3.0' && node.nullable === true && !types.includes('null')) types = [...types, 'null']
        if (!types) {
            const constrained: string[] = Object.keys(TYPE_KEYWORDS).filter((type: string): boolean => TYPE_KEYWORDS[type].some((keyword: string): boolean => node[keyword] !== undefined))
            if (!constrained.length) return undefined
            types = ['null', 'boolean', 'number', 'string', 'array', 'object']
        }
        types = types.filter((type: string): boolean => JSON_TYPES.includes(type))
        //Integers are numbers
        if (types.includes('number')) types = types.filter((type: string): boolean => type !== 'integer')
        const unique: string[] = [...new Set(types)]
        //Null is allowed besides the other types
        const nullable: boolean = unique.length > 1 && unique.includes('null')
        const schemas: Base[] = unique.filter((type: string): boolean => !nullable || type !== 'null').map((type: string): Base => this.type(type, node, base))
        if (!schemas.length) return never()
        const schema: Base = schemas.length === 1 ? schemas[0] : Engine.alternatives().try(...schemas)
        return nullable ? schema.allow(null) : schema
    }

    /**
     * The schema of a type, with its keywords
     * @param type
     * @param node
     * @param base
     */
    protected type(type: string, node: SchemaObject, base: string): Base {
        switch (type) {
            case 'null':
                return Engine.any().valid(null)
            case 'boolean':
                return Engine.boolean()
            case 'integer':
            case 'number':
                return this.number(node, type === 'integer')
            case 'string':
                return this.string(node)
            case 'array':
                return this.array(node, base)
            default:
                return this.object(node, base)
        }
    }

    /**
     * The schema of the numbers of a JSON Schema
     * @param node
     * @param integer
     */
    protected number(node: SchemaObject, integer: boolean): Base {
        let schema: NumberSchema = Engine.number().unsafe()
        let minimum: number | undefined = typeof node.minimum === 'number' ? node.minimum : undefined
        let maximum: number | undefined = typeof node.maximum === 'number' ? node.maximum : undefined
        let greater: number | undefined = typeof node.exclusiveMinimum === 'number' ? node.exclusiveMinimum : undefined
        let less: number | undefined = typeof node.exclusiveMaximum === 'number' ? node.exclusiveMaximum : undefined
        //Draft 04 (and OpenAPI 3.0): boolean exclusive bounds
        if (node.exclusiveMinimum === true && minimum !== undefined) {
            greater = minimum
            minimum = undefined
        }
        if (node.exclusiveMaximum === true && maximum !== undefined) {
            less = maximum
            maximum = undefined
        }
        const format: unknown = node.format
        //The numeric types: the formats (as ajv-formats validates them), and the bounds of the integer types
        const typeName: string | undefined = typeof format === 'string' && ['int32', 'int64', 'float', 'double'].includes(format) ? format :
            integer ? Object.keys(integerTypes).find((name: string): boolean => integerTypes[name][0] === minimum && integerTypes[name][1] === maximum) :
                minimum === -FLOAT_MAX && maximum === FLOAT_MAX ? 'float' : undefined
        if (typeName) {
            schema = (schema as unknown as Record<string, () => NumberSchema>)[typeName].call(schema)
            if (typeName in integerTypes || typeName === 'float') {
                const [low, high] = typeName === 'float' ? [-FLOAT_MAX, FLOAT_MAX] : integerTypes[typeName]
                //The type bounds are not repeated
                if (minimum === low) minimum = undefined
                if (maximum === high) maximum = undefined
            }
        }
        if (integer && !(typeName && typeName in integerTypes)) schema = schema.integer()
        if (minimum !== undefined) schema = schema.min(minimum)
        if (maximum !== undefined) schema = schema.max(maximum)
        if (greater !== undefined) schema = schema.greater(greater)
        if (less !== undefined) schema = schema.less(less)
        if (typeof node.multipleOf === 'number' && node.multipleOf > 0) schema = schema.multiple(node.multipleOf)
        return schema
    }

    /**
     * The schema of the strings of a JSON Schema
     * @param node
     */
    protected string(node: SchemaObject): Base {
        //A minimum length (of zero at least) makes the empty string valid
        let schema: StringSchema = Engine.string().min(typeof node.minLength === 'number' ? node.minLength : 0)
        if (typeof node.maxLength === 'number') schema = schema.max(node.maxLength)
        if (typeof node.pattern === 'string') {
            let regex: RegExp
            try {
                regex = new RegExp(node.pattern, 'u')
            } catch {
                throw new SchemaConversionException(`Invalid pattern: ${node.pattern}`)
            }
            schema = schema.pattern(regex)
        }
        const format: unknown = node.format
        if (typeof format === 'string' && Object.prototype.hasOwnProperty.call(formats, format)) schema = schema.format(format)
        return schema
    }

    /**
     * The schema of the arrays of a JSON Schema
     * @param node
     * @param base
     */
    protected array(node: SchemaObject, base: string): Base {
        let schema: ArraySchema = Engine.array()
        //The ordered items: prefixItems (2020-12), or an items array (before)
        const prefix: SchemaNode[] | undefined = Array.isArray(node.prefixItems) ? this.list(node.prefixItems) : Array.isArray(node.items) ? this.list(node.items) : undefined
        const rest: unknown = prefix ? (Array.isArray(node.prefixItems) ? node.items : node.additionalItems) : node.items
        let maxItems: number | undefined = typeof node.maxItems === 'number' ? node.maxItems : undefined
        if (prefix && prefix.length) schema = schema.ordered(...prefix.map((item: SchemaNode): Base => this.node(item, base)))
        if (rest === false) {
            //No other items
            const length: number = prefix ? prefix.length : 0
            if (!prefix || !prefix.length) maxItems = maxItems === undefined ? length : Math.min(maxItems, length)
        } else if (isSchema(rest) && rest !== true) {
            schema = schema.items(this.node(rest, base))
        } else if (prefix && prefix.length) {
            schema = schema.items(Engine.any())
        }
        if (typeof node.minItems === 'number') schema = schema.min(node.minItems)
        if (maxItems !== undefined) schema = schema.max(maxItems)
        if (node.uniqueItems === true) schema = schema.unique()
        if (isSchema(node.contains)) {
            const min: number = typeof node.minContains === 'number' ? node.minContains : 1
            const max: number | undefined = typeof node.maxContains === 'number' ? node.maxContains : undefined
            //More matches than possible: no array
            if (max !== undefined && min > max) return never()
            schema = schema.has(this.node(node.contains, base), min === 1 && max === undefined ? {} : {min, max})
        }
        return schema
    }

    /**
     * The schema of the objects of a JSON Schema
     * @param node
     * @param base
     */
    protected object(node: SchemaObject, base: string): Base {
        const properties: SchemaObject = isObject(node.properties) ? node.properties : {}
        const required: string[] = Array.isArray(node.required) ? node.required.filter((key: unknown): key is string => typeof key === 'string') : []
        const patterns: { regex: RegExp, schema: Base }[] = []
        if (isObject(node.patternProperties)) {
            for (const [source, subschema] of Object.entries(node.patternProperties)) {
                if (!isSchema(subschema)) continue
                let regex: RegExp
                try {
                    regex = new RegExp(source, 'u')
                } catch {
                    throw new SchemaConversionException(`Invalid pattern: ${source}`)
                }
                patterns.push({regex, schema: this.node(subschema, base)})
            }
        }
        const additional: unknown = node.additionalProperties
        const keys: Record<string, Base> = {}
        for (const key of new Set([...Object.keys(properties), ...required])) {
            //The patterns apply to the properties too
            const matching: Base[] = patterns.filter(({regex}: { regex: RegExp }): boolean => regex.test(key)).map(({schema}: { schema: Base }): Base => schema)
            const schemas: Base[] = [...isSchema(properties[key]) ? [this.node(properties[key] as SchemaNode, base)] : [], ...matching]
            //A required key which is not a property, nor matches a pattern, is an additional property
            if (!isSchema(properties[key]) && !matching.length && isSchema(additional) && additional !== true) schemas.push(this.node(additional, base))
            const schema: Base = schemas.length === 0 ? Engine.any() : all(schemas)
            keys[key] = required.includes(key) ? schema.required() : schema.optional()
        }
        let schema: ObjectSchema = Engine.object(keys)
        for (const {regex, schema: patternSchema} of patterns) schema = schema.pattern(regex, patternSchema, {fallthrough: true})
        if (additional === false) {
            schema = schema.unknown(false)
        } else if (isSchema(additional) && additional !== true) {
            schema = schema.unknown(this.node(additional, base))
        } else {
            schema = schema.unknown(true)
        }
        if (isSchema(node.propertyNames)) schema = schema.keyNames(this.node(node.propertyNames, base))
        if (typeof node.minProperties === 'number') schema = schema.min(node.minProperties)
        if (typeof node.maxProperties === 'number') schema = schema.max(node.maxProperties)
        for (const keyword of ['dependencies', 'dependentRequired']) {
            const dependencies: unknown = node[keyword]
            if (!isObject(dependencies)) continue
            for (const [key, peers] of Object.entries(dependencies)) {
                if (Array.isArray(peers) && peers.length) schema = schema.with(key, peers.filter((peer: unknown): peer is string => typeof peer === 'string'))
            }
        }
        return schema
    }

    /**
     * The keys and the item indexes of a value the keywords of a JSON Schema evaluate (its annotations): the keywords
     * of the schema, and of its subschemas which match the value
     * @param node
     * @param base
     * @param value
     * @param helpers
     * @param path the schemas being evaluated (a recursion without progress evaluates nothing more)
     */
    protected evaluated(node: SchemaNode, base: string, value: unknown, helpers: ValidationHelpers, path: Set<SchemaNode> = new Set()): { keys: Set<string>, items: Set<number>, all: boolean } {
        const result: { keys: Set<string>, items: Set<number>, all: boolean } = {keys: new Set(), items: new Set(), all: false}
        if (!isObject(node) || path.has(node)) return result
        path = new Set(path).add(node)
        const id: unknown = node[this.idKeyword]
        if (typeof id === 'string' && !id.startsWith('#')) base = resolveUri(id, base)
        const add = (sub: { keys: Set<string>, items: Set<number>, all: boolean }): void => {
            sub.keys.forEach((key: string): Set<string> => result.keys.add(key))
            sub.items.forEach((index: number): Set<number> => result.items.add(index))
            result.all = result.all || sub.all
        }
        const matches = (subschema: SchemaNode): boolean => {
            const schema: Base = this.node(subschema, base)
            return schema.$_match(value, helpers.state.nest(schema, 'unevaluated'), helpers.prefs)
        }
        if (Array.isArray(value)) {
            const prefix: unknown = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : undefined
            if (Array.isArray(prefix)) for (let i: number = 0; i < Math.min(prefix.length, value.length); ++i) result.items.add(i)
            if ((node.items !== undefined && !Array.isArray(node.items)) || node.additionalItems !== undefined || node.unevaluatedItems !== undefined) result.all = true
            //The items contains matches (2020-12)
            if (isSchema(node.contains) && this.dialect !== 'draft-2019-09') {
                const contains: Base = this.node(node.contains, base)
                value.forEach((item: unknown, index: number): void => {
                    if (contains.$_match(item, helpers.state.nest(contains, 'unevaluated'), helpers.prefs)) result.items.add(index)
                })
            }
        } else if (isObject(value)) {
            const keys: string[] = Object.keys(value)
            if (isObject(node.properties)) {
                for (const key of Object.keys(node.properties)) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) result.keys.add(key)
                }
            }
            if (isObject(node.patternProperties)) {
                const patterns: RegExp[] = Object.keys(node.patternProperties).map((pattern: string): RegExp => new RegExp(pattern, 'u'))
                for (const key of keys) {
                    if (patterns.some((regex: RegExp): boolean => regex.test(key))) result.keys.add(key)
                }
            }
            if (node.additionalProperties !== undefined || node.unevaluatedProperties !== undefined) result.all = true
            for (const [key, dependency] of Object.entries(this.dependentSchemas(node))) {
                if (Object.prototype.hasOwnProperty.call(value, key) && matches(dependency)) add(this.evaluated(dependency, base, value, helpers, path))
            }
        }
        for (const subschema of this.list(node.allOf)) add(this.evaluated(subschema, base, value, helpers, path))
        for (const subschema of [...this.list(node.anyOf), ...this.list(node.oneOf)]) {
            if (matches(subschema)) add(this.evaluated(subschema, base, value, helpers, path))
        }
        if (isSchema(node.if)) {
            if (matches(node.if)) {
                add(this.evaluated(node.if, base, value, helpers, path))
                if (isSchema(node.then)) add(this.evaluated(node.then, base, value, helpers, path))
            } else if (isSchema(node.else)) {
                add(this.evaluated(node.else, base, value, helpers, path))
            }
        }
        const reference: unknown = node.$ref ?? node.$dynamicRef ?? node.$recursiveRef
        if (typeof reference === 'string') {
            const target: Resolved = this.resolve(reference, base)
            add(this.evaluated(target.node, target.base, value, helpers, path))
        }
        return result
    }

    /**
     * The schema of unevaluatedProperties and unevaluatedItems: the keys and the items the keywords of the JSON Schema
     * (and of its subschemas which match the value) do not evaluate must match them
     * @param node
     * @param base
     */
    protected unevaluated(node: SchemaObject, base: string): Base | undefined {
        const {unevaluatedProperties, unevaluatedItems, ...rest} = node
        const properties: Base | undefined = isSchema(unevaluatedProperties) && unevaluatedProperties !== true ? this.node(unevaluatedProperties, base) : undefined
        const items: Base | undefined = isSchema(unevaluatedItems) && unevaluatedItems !== true ? this.node(unevaluatedItems, base) : undefined
        if (!properties && !items) return undefined
        return Engine.any().custom((value: unknown, helpers: ValidationHelpers): unknown => {
            const isArray: boolean = Array.isArray(value)
            if (isArray ? !items : !properties || !isObject(value)) return value
            const evaluated: { keys: Set<string>, items: Set<number>, all: boolean } = this.evaluated(rest, base, value, helpers)
            if (evaluated.all) return value
            const schema: Base = (isArray ? items : properties) as Base
            const entries: [string | number, unknown][] = isArray ? (value as unknown[]).map((item: unknown, index: number): [number, unknown] => [index, item]) : Object.entries(value as SchemaObject)
            for (const [key, item] of entries) {
                if (isArray ? evaluated.items.has(key as number) : evaluated.keys.has(key as string)) continue
                if (!schema.$_match(item, helpers.state.nest(schema, 'unevaluated'), helpers.prefs)) {
                    return helpers.message({custom: `{{#label}} has an unevaluated ${isArray ? 'item' : 'key'} {{#name}} which is not allowed`}, {name: key})
                }
            }
            return value
        }, 'unevaluated keys and items')
    }

    /**
     * Adds the annotations of a JSON Schema
     * @param schema
     * @param node
     */
    protected annotate(schema: Base, node: SchemaObject): Base {
        if (typeof node.description === 'string' && node.description) schema = schema.description(node.description)
        if (node.default !== undefined) schema = schema.default(node.default)
        const examples: unknown[] = Array.isArray(node.examples) ? node.examples : node.example !== undefined ? [node.example] : []
        for (const example of examples) schema = schema.example(example)
        const meta: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(node)) {
            if (['title', 'deprecated', 'readOnly', 'writeOnly', 'contentEncoding', 'contentMediaType'].includes(key) || key.startsWith('x-')) meta[key] = value
        }
        //The formats which are not validated are annotations
        if (typeof node.format === 'string' && !Object.prototype.hasOwnProperty.call(formats, node.format) && !['int32', 'int64', 'float', 'double'].includes(node.format)) meta.format = node.format
        if (Object.keys(meta).length) schema = schema.meta(meta)
        return schema
    }
}

/**
 * Converts a JSON Schema (or an OpenAPI schema object) into a schema
 * @param schema
 * @param options
 */
export function fromJsonSchema(schema: unknown, options: ImportOptions = {}): Base {
    if (!isSchema(schema)) throw new SchemaConversionException('A JSON Schema must be an object or a boolean')
    return new Importer(schema, options).run()
}
