import { AsyncLocalStorage } from 'node:async_hooks'
import * as mingo from './mingo/index.js'
import { bsonTypeName, withCollation } from './mingo/util/_bson.js'
import { type EmbeddedCollator } from './Collation.js'
import { EmbeddedOperationError } from './Errors.js'
import { type EmbeddedKeyEncoding } from './KeyEncoding.js'
import { type EmbeddedDocument } from './Values.js'

/**
 * The writes run without the validation of their documents (bypassDocumentValidation)
 */
const bypassed = new AsyncLocalStorage<boolean>()

/**
 * Runs a function whose writes leave out the validation of their documents (bypassDocumentValidation)
 *
 * @param bypass whether they leave it out
 * @param fn
 * @internal
 */
export function bypassingValidation<T>(bypass: unknown, fn: () => Promise<T>): Promise<T> {
    return bypass ? bypassed.run(true, fn) : fn()
}

/**
 * Whether the writes running leave out the validation of their documents
 * @internal
 */
export function validationBypassed(): boolean {
    return bypassed.getStore() === true
}

/**
 * The levels and the actions of the validation, as MongoDB 8.0 takes them
 */
const LEVELS = ['off', 'strict', 'moderate']
const ACTIONS = ['error', 'warn']

/**
 * The BSON type of a value, as MongoDB names it (consideredType, $type, bsonType)
 * @internal
 */
export {bsonTypeName}

/**
 * Whether a value is a number of BSON (double, int, long, decimal)
 *
 * @param value
 */
function isNumber(value: unknown): boolean {
    return ['int', 'double', 'long', 'decimal'].includes(bsonTypeName(value))
}

/**
 * Whether a value is a document (an object of fields, not a value of BSON)
 *
 * @param value
 */
function isDocument(value: unknown): value is EmbeddedDocument {
    return bsonTypeName(value) === 'object'
}

/**
 * The types of $jsonSchema: its bsonType (the aliases of $type), its type (the ones of JSON)
 */
const BSON_TYPES = new Set([
    'double', 'string', 'object', 'array', 'binData', 'undefined', 'objectId', 'bool', 'date', 'null', 'regex',
    'dbPointer', 'javascript', 'symbol', 'javascriptWithScope', 'int', 'timestamp', 'long', 'decimal', 'minKey',
    'maxKey', 'number'
])
const JSON_TYPES: Record<string, (value: unknown) => boolean> = {
    object: isDocument,
    array: Array.isArray,
    number: isNumber,
    boolean: (value) => typeof value === 'boolean',
    string: (value) => typeof value === 'string',
    null: (value) => value === null
}

/**
 * The keywords of $jsonSchema: the ones MongoDB 8.0 supports, the ones it refuses
 */
const SCHEMA_KEYWORDS = new Set([
    'type', 'bsonType', 'properties', 'required', 'additionalProperties', 'patternProperties', 'minProperties',
    'maxProperties', 'dependencies', 'items', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems', 'minimum',
    'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'enum',
    'allOf', 'anyOf', 'oneOf', 'not', 'title', 'description'
])
const UNSUPPORTED_KEYWORDS = new Set(['$ref', '$schema', 'default', 'definitions', 'format', 'id'])

/**
 * The query operators of a field, and the ones a validator refuses
 */
const FIELD_OPERATORS = new Set([
    '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$type', '$all', '$size', '$elemMatch',
    '$regex', '$options', '$mod', '$bitsAllSet', '$bitsAllClear', '$bitsAnySet', '$bitsAnyClear', '$not',
    '$geoWithin', '$geoIntersects'
])
const NEAR_OPERATORS = new Set(['$near', '$nearSphere', '$geoNear'])

/**
 * The reasons of the details of an operator failing (and of one matching, under $not or $nor), as MongoDB 8.0 tells
 * them
 */
const REASONS: Record<string, [string, string]> = {
    $eq: ['comparison failed', 'comparison succeeded'],
    $gt: ['comparison failed', 'comparison succeeded'],
    $gte: ['comparison failed', 'comparison succeeded'],
    $lt: ['comparison failed', 'comparison succeeded'],
    $lte: ['comparison failed', 'comparison succeeded'],
    $ne: ['comparison succeeded', 'comparison failed'],
    $in: ['no matching value found in array', 'matching value found in array'],
    $nin: ['matching value found in array', 'no matching value found in array'],
    $regex: ['regular expression did not match', 'regular expression did match'],
    $mod: ['$mod did not evaluate to expected remainder', '$mod did evaluate to expected remainder'],
    $bitsAllSet: ['bitwise operator failed to match', 'bitwise operator matched successfully'],
    $bitsAllClear: ['bitwise operator failed to match', 'bitwise operator matched successfully'],
    $bitsAnySet: ['bitwise operator failed to match', 'bitwise operator matched successfully'],
    $bitsAnyClear: ['bitwise operator failed to match', 'bitwise operator matched successfully'],
    $type: ['type did not match', 'type did match'],
    $all: ['array did not contain all specified values', 'array did contain all specified values'],
    $size: ['array length was not equal to given size', 'array length was equal to given size'],
    $elemMatch: ['array did not satisfy the child predicate', 'array did satisfy the child predicate'],
    $geoWithin: ['none of considered geometries was contained within the expression’s geometry', 'at least one of considered geometries was contained within the expression’s geometry'],
    $geoIntersects: ['none of considered geometries intersected the expression’s geometry', 'at least one of considered geometries intersected the expression’s geometry']
}

/**
 * The operators on arrays: their considered value is the array
 */
const ARRAY_OPERATORS = new Set(['$all', '$size', '$elemMatch'])

/**
 * A predicate of a validator, as MongoDB parses it: $and (a document of several predicates, or the operator), $or,
 * $nor, $not, $expr, $jsonSchema, or an operator of a field (its criteria: the predicate alone, as mingo takes it)
 */
type Predicate =
    | { kind: 'and' | 'or' | 'nor', clauses: Predicate[] }
    | { kind: 'not', child: Predicate }
    | { kind: 'expr', expression: unknown }
    | { kind: 'schema', schema: EmbeddedDocument }
    | { kind: 'field', path: string, operator: string, criteria: EmbeddedDocument }

/**
 * An error of the parsing of a validator, as MongoDB fails it
 *
 * @param code
 * @param message
 */
function invalid(code: number, message: string): EmbeddedOperationError {
    const names: Record<number, string> = { 2: 'BadValue', 9: 'FailedToParse', 14: 'TypeMismatch' }
    return new EmbeddedOperationError(code, names[code] ?? `Location${code}`, message)
}

/**
 * The validator of a collection (its option validator): the documents it allows, the details of the ones it does not,
 * as MongoDB 8.0 tells them (errInfo.details of DocumentValidationFailure, 121). Its strings are compared by the
 * collation of the collection.
 *
 * @internal
 */
export class EmbeddedValidator {
    /**
     * The predicate of the validator
     */
    protected readonly predicate: Predicate

    /**
     * The tests of the operators of the fields and of $expr (mingo), compiled with the validator
     */
    protected readonly tests: Map<Predicate, (document: EmbeddedDocument) => boolean> = new Map()

    /**
     * @param validator
     * @param keys the encoding of the keys, which tells the values equal (enum, uniqueItems)
     * @param collator the collation of the collection, if any
     */
    constructor(readonly validator: EmbeddedDocument, protected readonly keys: EmbeddedKeyEncoding, protected readonly collator?: EmbeddedCollator) {
        this.predicate = this.documentOf(validator)
        this.compile(this.predicate)
    }

    /**
     * Checks a validator as MongoDB 8.0 parses it (at createCollection, at collMod): its operators, its $jsonSchema
     *
     * @param validator
     * @param keys
     * @param field the field of the validator, as its errors tell it (create.validator)
     */
    static check(validator: unknown, keys: EmbeddedKeyEncoding, field: string): void {
        if (!isDocument(validator)) throw invalid(14, `BSON field '${field}' is the wrong type '${bsonTypeName(validator)}', expected type 'object'`)
        void new EmbeddedValidator(validator, keys)
    }

    /**
     * Checks the level and the action of a validation (createCollection, collMod)
     *
     * @param command the command, as its errors tell it (create, collMod)
     * @param level
     * @param action
     */
    static checkModes(command: string, level: unknown, action: unknown): void {
        if (level !== undefined && !LEVELS.includes(level as string))
            throw invalid(2, `Enumeration value '${String(level)}' for field '${command}.validationLevel' is not a valid value.`)
        if (action !== undefined && !ACTIONS.includes(action as string))
            throw invalid(2, `Enumeration value '${String(action)}' for field '${command}.validationAction' is not a valid value.`)
    }

    /**
     * Whether a document is valid
     *
     * @param document
     */
    test(document: EmbeddedDocument): boolean {
        return withCollation(this.collator, () => this.holds(this.predicate, document))
    }

    /**
     * The details of a document failing the validator, as MongoDB 8.0 tells them
     *
     * @param document
     */
    details(document: EmbeddedDocument): EmbeddedDocument {
        return withCollation(this.collator, () => this.explained(this.predicate, document, false))
    }

    /**
     * The predicate of a document of predicates: the one alone, or $and of them ($comment left out)
     *
     * @param document
     */
    protected documentOf(document: EmbeddedDocument): Predicate {
        const clauses: Predicate[] = []
        for (const [key, value] of Object.entries(document)) {
            if (value === undefined) continue
            if (key === '$comment') continue
            if (key === '$and' || key === '$or' || key === '$nor') {
                if (!Array.isArray(value) || !value.length) throw invalid(2, `${key} must be a nonempty array`)
                clauses.push({ kind: key.slice(1) as 'and' | 'or' | 'nor', clauses: value.map((clause) => {
                    if (!isDocument(clause)) throw invalid(2, `${key} argument's entries must be objects`)
                    return this.documentOf(clause)
                }) })
            } else if (key === '$expr') {
                this.checkExpression(value)
                clauses.push({ kind: 'expr', expression: value })
            } else if (key === '$jsonSchema') {
                if (!isDocument(value)) throw invalid(14, `$jsonSchema must be an object`)
                this.checkSchema(value)
                clauses.push({ kind: 'schema', schema: value })
            } else if (key === '$where' || key === '$text') throw invalid(2, `${key} is not allowed in this context`)
            else if (key.startsWith('$')) throw invalid(2, `unknown top level operator: ${key}`)
            else clauses.push(...this.fieldOf(key, value))
        }
        return clauses.length === 1 ? clauses[0] : { kind: 'and', clauses: clauses }
    }

    /**
     * The predicates of a field: its operators, each one alone ($regex with its $options), or its equality
     *
     * @param path
     * @param value
     */
    protected fieldOf(path: string, value: unknown): Predicate[] {
        if (value instanceof RegExp || (value as { _bsontype?: string })?._bsontype === 'BSONRegExp')
            return [{ kind: 'field', path: path, operator: '$regex', criteria: { [path]: value } }]
        if (!isDocument(value) || !Object.keys(value).some((key) => key.startsWith('$')))
            return [{ kind: 'field', path: path, operator: '$eq', criteria: { [path]: value } }]
        const predicates: Predicate[] = []
        for (const [operator, argument] of Object.entries(value)) {
            if (argument === undefined) continue
            if (NEAR_OPERATORS.has(operator))
                throw invalid(5626500, '$geoNear, $near, and $nearSphere are not allowed in this context, as these operators require sorting geospatial data. If you do not need sort, consider using $geoWithin instead.')
            if (!FIELD_OPERATORS.has(operator)) throw invalid(2, `unknown operator: ${operator}`)
            if (operator === '$options') {
                if (value.$regex === undefined) throw invalid(2, '$options needs a $regex')
                continue
            }
            if (operator === '$not') {
                const children = isDocument(argument) && Object.keys(argument).every((key) => key.startsWith('$'))
                    ? this.fieldOf(path, argument)
                    : argument instanceof RegExp || (argument as { _bsontype?: string })?._bsontype === 'BSONRegExp'
                      ? this.fieldOf(path, argument)
                      : undefined
                if (!children) throw invalid(2, '$not needs a regex or a document')
                predicates.push({ kind: 'not', child: children.length === 1 ? children[0] : { kind: 'and', clauses: children } })
                continue
            }
            if (operator === '$elemMatch' && !isDocument(argument)) throw invalid(2, '$elemMatch needs an Object')
            const criteria = operator === '$regex'
                ? { [path]: value.$options === undefined ? { $regex: argument } : { $regex: argument, $options: value.$options } }
                : { [path]: { [operator]: argument } }
            predicates.push({ kind: 'field', path: path, operator: operator, criteria: criteria })
        }
        return predicates
    }

    /**
     * Checks the expression of $expr: $function, $accumulator and $where are not allowed in a validator
     *
     * @param expression
     */
    protected checkExpression(expression: unknown): void {
        if (Array.isArray(expression)) return expression.forEach((item) => this.checkExpression(item))
        if (!isDocument(expression)) return
        for (const [key, value] of Object.entries(expression)) {
            if (key === '$function') throw invalid(4660800, '$function cannot be used inside a validator.')
            if (key === '$accumulator') throw invalid(4660801, '$accumulator cannot be used inside a validator.')
            this.checkExpression(value)
        }
    }

    /**
     * Checks a schema of $jsonSchema as MongoDB 8.0 parses it: its keywords, its types, the schemas in it
     *
     * @param schema
     */
    protected checkSchema(schema: unknown): void {
        if (!isDocument(schema)) throw invalid(9, '$jsonSchema keyword must be an object')
        for (const keyword of Object.keys(schema)) {
            if (UNSUPPORTED_KEYWORDS.has(keyword)) throw invalid(9, `$jsonSchema keyword '${keyword}' is not currently supported`)
            if (!SCHEMA_KEYWORDS.has(keyword)) throw invalid(9, `Unknown $jsonSchema keyword: ${keyword}`)
        }
        if (schema.type !== undefined && schema.bsonType !== undefined)
            throw invalid(9, "Cannot specify both $jsonSchema keywords 'type' and 'bsonType'")
        for (const type of [schema.type ?? []].flat()) {
            if (type === 'integer') throw invalid(9, "$jsonSchema type 'integer' is not currently supported.")
            if (typeof type !== 'string' || !(type in JSON_TYPES)) throw invalid(2, `Unknown $jsonSchema type: ${String(type)}`)
        }
        for (const type of [schema.bsonType ?? []].flat())
            if (typeof type !== 'string' || !BSON_TYPES.has(type)) throw invalid(2, `Unknown type name alias: ${String(type)}`)
        if (schema.exclusiveMinimum !== undefined && schema.minimum === undefined)
            throw invalid(9, "$jsonSchema keyword 'minimum' must be a present if exclusiveMinimum is present")
        if (schema.exclusiveMaximum !== undefined && schema.maximum === undefined)
            throw invalid(9, "$jsonSchema keyword 'maximum' must be a present if exclusiveMaximum is present")
        for (const keyword of ['properties', 'patternProperties'])
            for (const sub of Object.values(schema[keyword] ?? {})) this.checkSchema(sub)
        if (schema.pattern !== undefined) this.regexOf(schema.pattern, 'pattern')
        for (const pattern of Object.keys(schema.patternProperties ?? {})) this.regexOf(pattern, 'patternProperties')
        for (const keyword of ['additionalProperties', 'additionalItems'])
            if (isDocument(schema[keyword])) this.checkSchema(schema[keyword])
        if (schema.items !== undefined) [schema.items].flat().forEach((sub) => this.checkSchema(sub))
        for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
            if (schema[keyword] === undefined) continue
            if (!Array.isArray(schema[keyword]) || !schema[keyword].length)
                throw invalid(9, `$jsonSchema keyword '${keyword}' must be a nonempty array`)
            schema[keyword].forEach((sub: unknown) => this.checkSchema(sub))
        }
        if (schema.not !== undefined) this.checkSchema(schema.not)
        for (const sub of Object.values(schema.dependencies ?? {})) if (!Array.isArray(sub)) this.checkSchema(sub)
        if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.length || schema.required.some((name: unknown) => typeof name !== 'string')))
            throw invalid(9, "$jsonSchema keyword 'required' must be a nonempty array of strings")
        if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length))
            throw invalid(9, "$jsonSchema keyword 'enum' cannot be an empty array")
    }

    /**
     * The regular expression of a pattern of $jsonSchema
     *
     * @param pattern
     * @param keyword
     */
    protected regexOf(pattern: unknown, keyword: string): RegExp {
        if (typeof pattern !== 'string') throw invalid(9, `$jsonSchema keyword '${keyword}' must be a string`)
        try {
            return new RegExp(pattern, 'u')
        } catch {
            throw invalid(51091, `Regular expression is invalid: ${pattern}`)
        }
    }

    /**
     * The tests of the operators of the fields and of $expr of a predicate, compiled by mingo (an error of mingo fails
     * with BadValue, 2)
     *
     * @param predicate
     */
    protected compile(predicate: Predicate): void {
        switch (predicate.kind) {
            case 'and':
            case 'or':
            case 'nor':
                return predicate.clauses.forEach((clause) => this.compile(clause))
            case 'not':
                return this.compile(predicate.child)
            case 'schema':
                return
        }
        let query: mingo.Query
        try {
            query = new mingo.Query(predicate.kind === 'expr' ? { $expr: predicate.expression } : predicate.criteria)
        } catch (error) {
            throw invalid(2, (error as Error).message)
        }
        this.tests.set(predicate, (document) => query.test(document))
    }

    /**
     * Whether a document satisfies a predicate
     *
     * @param predicate
     * @param document
     */
    protected holds(predicate: Predicate, document: EmbeddedDocument): boolean {
        switch (predicate.kind) {
            case 'and':
                return predicate.clauses.every((clause) => this.holds(clause, document))
            case 'or':
                return predicate.clauses.some((clause) => this.holds(clause, document))
            case 'nor':
                return !predicate.clauses.some((clause) => this.holds(clause, document))
            case 'not':
                return !this.holds(predicate.child, document)
            case 'schema':
                return !this.schemaFailures(predicate.schema, document).length
        }
        return this.tests.get(predicate)!(document)
    }

    /**
     * The details of a predicate: failing (inverted false), or satisfied under $not or $nor (inverted true)
     *
     * @param predicate
     * @param document
     * @param inverted
     */
    protected explained(predicate: Predicate, document: EmbeddedDocument, inverted: boolean): EmbeddedDocument {
        switch (predicate.kind) {
            case 'and':
            case 'or':
            case 'nor': {
                // The clauses that make it fail (or hold, inverted): the ones failing of $and and $or, the ones holding of
                // $nor; inverted, the ones holding of $and and $or, the ones failing of $nor
                const satisfying = (predicate.kind === 'nor') !== inverted
                const listed = predicate.clauses
                    .map((clause, index) => ({ clause: clause, index: index }))
                    .filter(({ clause }) => this.holds(clause, document) === satisfying)
                return {
                    operatorName: `$${predicate.kind}`,
                    [satisfying ? 'clausesSatisfied' : 'clausesNotSatisfied']: listed.map(({ clause, index }) => ({
                        index: index,
                        ...(clause.kind === 'schema' ? this.annotations(clause.schema) : {}),
                        details: this.explained(clause, document, satisfying)
                    }))
                }
            }
            case 'not':
                return { operatorName: '$not', details: this.explained(predicate.child, document, !inverted) }
            case 'expr':
                return {
                    operatorName: '$expr',
                    specifiedAs: { $expr: predicate.expression },
                    reason: inverted ? 'expression did match' : 'expression did not match',
                    expressionResult: this.evaluated(predicate.expression, document)
                }
            case 'schema':
                return {
                    operatorName: '$jsonSchema',
                    ...this.annotations(predicate.schema),
                    ...(inverted ? { reason: 'schema matched' } : { schemaRulesNotSatisfied: this.schemaFailures(predicate.schema, document) })
                }
        }
        return this.fieldExplained(predicate, document, inverted)
    }

    /**
     * The details of an operator of a field
     *
     * @param predicate
     * @param document
     * @param inverted
     */
    protected fieldExplained(predicate: Extract<Predicate, { kind: 'field' }>, document: EmbeddedDocument, inverted: boolean): EmbeddedDocument {
        const { operator, path } = predicate
        const details: EmbeddedDocument = { operatorName: operator, specifiedAs: predicate.criteria }
        if (operator === '$exists') {
            const exists = !!predicate.criteria[path].$exists
            details.reason = exists !== inverted ? 'path does not exist' : 'path does exist'
            return details
        }
        const found = this.considered(document, path)
        if (!found.reached) {
            details.reason = 'field was missing'
            return details
        }
        if (ARRAY_OPERATORS.has(operator)) {
            const value = found.leaf
            if (!Array.isArray(value)) {
                details.reason = 'type did not match'
                details.consideredType = bsonTypeName(value)
                details.expectedType = 'array'
                details.consideredValue = value
                return details
            }
            details.reason = REASONS[operator][inverted ? 1 : 0]
            details.consideredValue = value
            return details
        }
        details.reason = (REASONS[operator] ?? ['expression did not match', 'expression did match'])[inverted ? 1 : 0]
        if (found.many) details.consideredValues = found.values
        else details.consideredValue = found.values[0]
        if (operator === '$type') {
            const types = [...new Set(found.values.map(bsonTypeName))]
            if (types.length === 1) details.consideredType = types[0]
            else details.consideredTypes = types
        }
        return details
    }

    /**
     * The values of a path of a document, as MongoDB considers them: the elements of the arrays on the path, the ones
     * of an array at its end; whether its end was reached, whether the values came from arrays, the value at its end
     *
     * @param document
     * @param path
     */
    protected considered(document: EmbeddedDocument, path: string): { reached: boolean, many: boolean, values: unknown[], leaf?: unknown } {
        const parts = path.split('.')
        const values: unknown[] = []
        let reached = false
        let many = false
        let leaf: unknown
        const walk = (value: unknown, at: number): void => {
            if (at === parts.length) {
                if (!reached) leaf = value
                else many = true
                reached = true
                if (Array.isArray(value)) {
                    many = true
                    values.push(...value)
                } else values.push(value)
                return
            }
            const part = parts[at]
            if (Array.isArray(value)) {
                many = true
                if (/^\d+$/.test(part) && Number(part) < value.length) walk(value[Number(part)], at + 1)
                for (const element of value) if (isDocument(element) && element[part] !== undefined) walk(element[part], at + 1)
                return
            }
            if (isDocument(value) && value[part] !== undefined) walk(value[part], at + 1)
        }
        walk(document, 0)
        return { reached: reached, many: many, values: values, leaf: leaf }
    }

    /**
     * The value of the expression of $expr for a document
     *
     * @param expression
     * @param document
     */
    protected evaluated(expression: unknown, document: EmbeddedDocument): unknown {
        try {
            const [result] = new mingo.Aggregator([{ $addFields: { __expressionResult: expression } }]).run([document])
            return (result as EmbeddedDocument | undefined)?.__expressionResult ?? null
        } catch {
            return null
        }
    }

    /**
     * The title and the description of a schema, when it has them
     *
     * @param schema
     */
    protected annotations(schema: EmbeddedDocument): EmbeddedDocument {
        return {
            ...(schema.title !== undefined ? { title: schema.title } : {}),
            ...(schema.description !== undefined ? { description: schema.description } : {})
        }
    }

    /**
     * Whether two values are equal as MongoDB compares them (1, 1.0 and Long(1) together)
     *
     * @param a
     * @param b
     */
    protected same(a: unknown, b: unknown): boolean {
        return this.keys.encode(a).equals(this.keys.encode(b))
    }

    /**
     * The rules of a schema of $jsonSchema a value breaks, in the order of MongoDB 8.0: its type; the ones of the strings
     * and of the numbers; of the arrays; of the documents; allOf, anyOf, oneOf, not, enum. None: it satisfies it.
     *
     * @param schema
     * @param value
     */
    schemaFailures(schema: EmbeddedDocument, value: unknown): EmbeddedDocument[] {
        const failures: EmbeddedDocument[] = []
        const type = bsonTypeName(value)
        // Its type
        if (schema.bsonType !== undefined) {
            const types = [schema.bsonType].flat()
            if (!types.some((name) => name === type || (name === 'number' && isNumber(value))))
                failures.push({ operatorName: 'bsonType', specifiedAs: { bsonType: schema.bsonType }, reason: 'type did not match', consideredValue: value, consideredType: type })
        }
        if (schema.type !== undefined) {
            const types = [schema.type].flat()
            if (!types.some((name) => JSON_TYPES[name]?.(value)))
                failures.push({ operatorName: 'type', specifiedAs: { type: schema.type }, reason: 'type did not match', consideredValue: value, consideredType: type })
        }
        // The strings and the numbers
        if (typeof value === 'string') {
            const length = [...value].length
            if (schema.pattern !== undefined && !this.regexOf(schema.pattern, 'pattern').test(value))
                failures.push({ operatorName: 'pattern', specifiedAs: { pattern: schema.pattern }, reason: 'regular expression did not match', consideredValue: value })
            if (schema.maxLength !== undefined && length > Number(schema.maxLength))
                failures.push({ operatorName: 'maxLength', specifiedAs: { maxLength: schema.maxLength }, reason: 'specified string length was not satisfied', consideredValue: value })
            if (schema.minLength !== undefined && length < Number(schema.minLength))
                failures.push({ operatorName: 'minLength', specifiedAs: { minLength: schema.minLength }, reason: 'specified string length was not satisfied', consideredValue: value })
        }
        if (isNumber(value)) {
            const number = Number(value)
            if (schema.multipleOf !== undefined && number % Number(schema.multipleOf) !== 0)
                failures.push({ operatorName: 'multipleOf', specifiedAs: { multipleOf: schema.multipleOf }, reason: 'considered value is not a multiple of the specified value', consideredValue: value })
            if (schema.maximum !== undefined && (schema.exclusiveMaximum ? number >= Number(schema.maximum) : number > Number(schema.maximum)))
                failures.push({ operatorName: 'maximum', specifiedAs: { maximum: schema.maximum, ...(schema.exclusiveMaximum ? { exclusiveMaximum: true } : {}) }, reason: 'comparison failed', consideredValue: value })
            if (schema.minimum !== undefined && (schema.exclusiveMinimum ? number <= Number(schema.minimum) : number < Number(schema.minimum)))
                failures.push({ operatorName: 'minimum', specifiedAs: { minimum: schema.minimum, ...(schema.exclusiveMinimum ? { exclusiveMinimum: true } : {}) }, reason: 'comparison failed', consideredValue: value })
        }
        // The arrays
        if (Array.isArray(value)) failures.push(...this.arrayFailures(schema, value))
        // The documents
        if (isDocument(value)) failures.push(...this.documentFailures(schema, value))
        // The schemas together, the values allowed
        if (schema.allOf !== undefined) {
            const failing = (schema.allOf as EmbeddedDocument[])
                .map((sub, index) => ({ index: index, details: this.schemaFailures(sub, value) }))
                .filter(({ details }) => details.length)
            if (failing.length) failures.push({ operatorName: 'allOf', schemasNotSatisfied: failing })
        }
        if (schema.anyOf !== undefined) {
            const results = (schema.anyOf as EmbeddedDocument[]).map((sub, index) => ({ index: index, details: this.schemaFailures(sub, value) }))
            if (results.every(({ details }) => details.length)) failures.push({ operatorName: 'anyOf', schemasNotSatisfied: results })
        }
        if (schema.oneOf !== undefined) {
            const results = (schema.oneOf as EmbeddedDocument[]).map((sub, index) => ({ index: index, details: this.schemaFailures(sub, value) }))
            const matching = results.filter(({ details }) => !details.length).map(({ index }) => index)
            if (!matching.length) failures.push({ operatorName: 'oneOf', schemasNotSatisfied: results })
            else if (matching.length > 1) failures.push({ operatorName: 'oneOf', reason: 'more than one subschema matched', matchingSchemaIndexes: matching })
        }
        if (schema.not !== undefined && !this.schemaFailures(schema.not, value).length)
            failures.push({ operatorName: 'not', reason: 'child expression matched' })
        if (schema.enum !== undefined && !(schema.enum as unknown[]).some((allowed) => this.same(allowed, value)))
            failures.push({ operatorName: 'enum', specifiedAs: { enum: schema.enum }, reason: 'value was not found in enum', consideredValue: value })
        return failures
    }

    /**
     * The rules of the arrays of a schema an array breaks: minItems, maxItems, uniqueItems, items, additionalItems
     *
     * @param schema
     * @param value
     */
    protected arrayFailures(schema: EmbeddedDocument, value: unknown[]): EmbeddedDocument[] {
        const failures: EmbeddedDocument[] = []
        if (schema.minItems !== undefined && value.length < Number(schema.minItems))
            failures.push({ operatorName: 'minItems', specifiedAs: { minItems: schema.minItems }, reason: 'array did not match specified length', consideredValue: value, numberOfItems: value.length })
        if (schema.maxItems !== undefined && value.length > Number(schema.maxItems))
            failures.push({ operatorName: 'maxItems', specifiedAs: { maxItems: schema.maxItems }, reason: 'array did not match specified length', consideredValue: value, numberOfItems: value.length })
        if (schema.uniqueItems === true) {
            const seen: Buffer[] = []
            const duplicate = value.find((item) => {
                const key = this.keys.encode(item)
                if (seen.some((other) => other.equals(key))) return true
                seen.push(key)
                return false
            })
            if (duplicate !== undefined)
                failures.push({ operatorName: 'uniqueItems', specifiedAs: { uniqueItems: true }, reason: 'found a duplicate item', consideredValue: value, duplicatedValue: duplicate })
        }
        if (isDocument(schema.items)) {
            for (const [index, item] of value.entries()) {
                const details = this.schemaFailures(schema.items, item)
                if (!details.length) continue
                failures.push({ operatorName: 'items', reason: 'At least one item did not match the sub-schema', itemIndex: index, details: details })
                break
            }
        } else if (Array.isArray(schema.items)) {
            const failing = (schema.items as EmbeddedDocument[])
                .slice(0, value.length)
                .map((sub, index) => ({ itemIndex: index, details: this.schemaFailures(sub, value[index]) }))
                .filter(({ details }) => details.length)
            if (failing.length) failures.push({ operatorName: 'items', details: failing })
            const extra = value.slice(schema.items.length)
            if (schema.additionalItems === false && extra.length)
                failures.push({ operatorName: 'additionalItems', specifiedAs: { additionalItems: false }, reason: 'found additional items', additionalItems: extra })
            else if (isDocument(schema.additionalItems))
                for (const [offset, item] of extra.entries()) {
                    const details = this.schemaFailures(schema.additionalItems, item)
                    if (!details.length) continue
                    failures.push({ operatorName: 'additionalItems', reason: 'At least one additional item did not match the sub-schema', itemIndex: schema.items.length + offset, details: details })
                    break
                }
        }
        return failures
    }

    /**
     * The rules of the documents of a schema a document breaks: properties, additionalProperties, patternProperties,
     * required, minProperties, maxProperties, dependencies
     *
     * @param schema
     * @param value
     */
    protected documentFailures(schema: EmbeddedDocument, value: EmbeddedDocument): EmbeddedDocument[] {
        const failures: EmbeddedDocument[] = []
        const names = Object.keys(value).filter((name) => value[name] !== undefined)
        if (isDocument(schema.properties)) {
            const failing: EmbeddedDocument[] = []
            for (const [name, sub] of Object.entries(schema.properties as Record<string, EmbeddedDocument>)) {
                if (value[name] === undefined) continue
                const details = this.schemaFailures(sub, value[name])
                if (details.length) failing.push({ propertyName: name, ...this.annotations(sub), details: details })
            }
            if (failing.length) failures.push({ operatorName: 'properties', propertiesNotSatisfied: failing })
        }
        const patterns = Object.entries((schema.patternProperties ?? {}) as Record<string, EmbeddedDocument>)
            .map(([pattern, sub]) => ({ pattern: pattern, regex: this.regexOf(pattern, 'patternProperties'), schema: sub }))
        if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
            const additional = names.filter((name) => !(name in (schema.properties ?? {})) && !patterns.some(({ regex }) => regex.test(name)))
            if (schema.additionalProperties === false) {
                if (additional.length)
                    failures.push({ operatorName: 'additionalProperties', specifiedAs: { additionalProperties: false }, additionalProperties: additional })
            } else
                for (const name of additional) {
                    const details = this.schemaFailures(schema.additionalProperties, value[name])
                    if (!details.length) continue
                    failures.push({ operatorName: 'additionalProperties', reason: 'at least one additional property did not match the subschema', failingProperty: name, details: details })
                    break
                }
        }
        if (patterns.length) {
            const failing: EmbeddedDocument[] = []
            for (const name of names)
                for (const { pattern, regex, schema: sub } of patterns) {
                    if (!regex.test(name)) continue
                    const details = this.schemaFailures(sub, value[name])
                    if (details.length) failing.push({ propertyName: name, regexMatched: pattern, details: details })
                }
            if (failing.length) failures.push({ operatorName: 'patternProperties', details: failing })
        }
        if (schema.required !== undefined) {
            const missing = (schema.required as string[]).filter((name) => value[name] === undefined)
            if (missing.length) failures.push({ operatorName: 'required', specifiedAs: { required: schema.required }, missingProperties: missing })
        }
        if (schema.minProperties !== undefined && names.length < Number(schema.minProperties))
            failures.push({ operatorName: 'minProperties', specifiedAs: { minProperties: schema.minProperties }, reason: 'specified number of properties was not satisfied', numberOfProperties: names.length })
        if (schema.maxProperties !== undefined && names.length > Number(schema.maxProperties))
            failures.push({ operatorName: 'maxProperties', specifiedAs: { maxProperties: schema.maxProperties }, reason: 'specified number of properties was not satisfied', numberOfProperties: names.length })
        if (isDocument(schema.dependencies)) {
            const failing: EmbeddedDocument[] = []
            for (const [name, dependency] of Object.entries(schema.dependencies)) {
                if (value[name] === undefined) continue
                if (Array.isArray(dependency)) {
                    const missing = (dependency as string[]).filter((other) => value[other] === undefined)
                    if (missing.length) failing.push({ conditionalProperty: name, missingProperties: missing })
                } else {
                    const details = this.schemaFailures(dependency as EmbeddedDocument, value)
                    if (details.length) failing.push({ conditionalProperty: name, details: details })
                }
            }
            if (failing.length) failures.push({ operatorName: 'dependencies', failingDependencies: failing })
        }
        return failures
    }
}

/**
 * The validation of a collection, as its options keep it: its validator, its level (strict, moderate, off) and its
 * action (error, warn)
 *
 * @internal
 */
export interface EmbeddedValidation {
    validator: EmbeddedValidator
    level: string
    action: string
}
