import type { EmbeddedKeyEncoding } from './KeyEncoding.js'
import type { EmbeddedDocument } from './Values.js'

/**
 * An index of a collection, as MongoDB lists it: its fields and their directions (1, -1, "hashed"; a wildcard field
 * "$**" or "<path>.$**"), whether its keys are unique, whether the documents without its fields are left out of it,
 * the filter of the documents it holds (a partial index), whether the queries leave it out (hidden), the fields of a
 * wildcard index. Its expiration is kept, not applied.
 */
export interface EmbeddedIndex {
    name: string
    key: { [field: string]: any }
    unique?: boolean
    sparse?: boolean
    partialFilterExpression?: EmbeddedDocument
    hidden?: boolean
    wildcardProjection?: EmbeddedDocument
    expireAfterSeconds?: number
}

/**
 * A bound of a range of the keys of an index: its key, and whether it is in the range.
 */
export interface EmbeddedBound {
    key: Uint8Array
    inclusive: boolean
}

/**
 * The collection a planner plans for: its indexes, the ones of which a document has several keys, and the encoding of
 * the keys.
 */
export interface EmbeddedPlannedCollection {
    readonly indexes: EmbeddedIndex[]
    readonly multikey: Set<string>
    readonly encoding: EmbeddedKeyEncoding
}

/**
 * a range of the keys of an index.
 */
export interface EmbeddedRange {
    lower?: EmbeddedBound
    upper?: EmbeddedBound
}

/**
 * the name of the index of the _id: the table of the collection, ordered by the keys of the _id.
 */
export const ID_INDEX = '_id_'

/**
 * how the documents a filter may match are found: by their _id, by the ranges of an index (the one of the _id: the
 * table of the collection), or by a scan of the collection (reversed: in the reverse order of the _id). Every document
 * the filter matches is among them (the filter tests them then), but with an index hinted that does not hold them all
 * (sparse, partial), as in MongoDB. An exact plan gives the documents the filter matches and no other, once each (a
 * count needs no document).
 */
export type EmbeddedPlan =
    | { kind: 'id', ids: any[], exact: boolean }
    | {
          kind: 'index'
          index: string
          ranges: EmbeddedRange[]
          exact: boolean
          multikey: boolean
      }
    | { kind: 'scan', exact: boolean, reverse?: boolean }

/**
 * a condition of a field on which an index may be used: an equality, a list of values, or a range; complete
 * when it is all the condition of the field (no other operator of it left to the filter).
 */
type Condition = { complete: boolean } & (
    | { kind: 'equal', values: any[] }
    | {
          kind: 'range'
          lower?: { value: any, inclusive: boolean }
          upper?: { value: any, inclusive: boolean }
      }
)

/**
 * the range operators of the queries of MongoDB.
 */
const RANGE_OPERATORS = ['$gt', '$gte', '$lt', '$lte']

/**
 * the smallest bytes greater than all the bytes starting with some (undefined when they are all 0xff).
 *
 * @param bytes
 */
function after(bytes: Buffer): Buffer | undefined {
    for (let index = bytes.length - 1; index >= 0; index--)
        if (bytes[index] !== 0xff) {
            const next = Buffer.from(bytes.subarray(0, index + 1))
            next[index]++
            return next
        }
    return undefined
}

/**
 * Whether a field of an index is its wildcard term: "$**", or "<path>.$**".
 *
 * @param field
 */
export function isWildcardField(field: string): boolean {
    return field === '$**' || field.endsWith('.$**')
}

/**
 * The path of the wildcard term of an index ("" for all the fields), undefined when it has none: a wildcard index, or a
 * compound one (its other terms fields).
 *
 * @param index
 */
export function wildcardOf(index: EmbeddedIndex): string | undefined {
    const field = Object.keys(index.key).find(isWildcardField)
    if (field === undefined) return undefined
    return field === '$**' ? '' : field.slice(0, -4)
}

/**
 * Whether a wildcard index holds the values of a path: the ones under its path ("<path>.$**"), or the ones of its
 * projection ("$**", the _id left out unless it includes it).
 *
 * @param index
 * @param path
 */
export function wildcardHolds(index: EmbeddedIndex, path: string): boolean {
    const wildcard = wildcardOf(index)
    if (wildcard === undefined) return false
    if (wildcard) return path === wildcard || path.startsWith(`${wildcard}.`)
    const projection = index.wildcardProjection
    const shown = (value: any) => !!value && value !== '0'
    if (path === '_id' || path.startsWith('_id.')) return !!projection && shown(projection._id)
    if (!projection) return true
    const fields = Object.keys(projection).filter((field) => field !== '_id')
    if (!fields.length) return true
    const under = (field: string) => path === field || path.startsWith(`${field}.`)
    return fields.some((field) => shown(projection[field]))
        ? fields.some((field) => shown(projection[field]) && under(field))
        : !fields.some((field) => under(field))
}

/**
 * plans the queries of a collection: the conditions of the fields of a filter (its fields and the ones of its
 * $and) on which its indexes may be used, without dropping a document the filter matches. An index is used for the
 * equalities and the lists of values ($eq, $in) of the values of a type it orders, other than null (which matches the
 * documents missing the field), and for the ranges of an ascending index ($gt, $gte, $lt, $lte); the other operators
 * ($ne, $nin, $not, $exists, $regex...) are left to the filter. An index of which a document has several keys keeps
 * one bound of a range (its two bounds may be met by different items of an array), the filter testing the documents.
 * A hidden index is left out; a partial index is used when it is hinted only (the filter may match documents it does
 * not hold); a hashed index for the equalities of its first field; a wildcard index for the fields it holds (but the
 * paths of the items of arrays), its documents tested by the filter.
 */
export class EmbeddedPlanner {
    constructor(protected readonly collection: EmbeddedPlannedCollection) {}

    /**
     * The plan of a filter, by an index when one is hinted (its name, its fields, or $natural for a scan).
     *
     * @param filter
     * @param hint
     */
    plan(filter: EmbeddedDocument, hint?: EmbeddedIndex | { $natural: number }): EmbeddedPlan {
        const conditions = this.conditionsOf(filter)
        const fields = Object.keys(filter).filter((key) => !key.startsWith('$'))
        const alone = fields.length === 1 && Object.keys(filter).length === 1
        if (hint && '$natural' in hint)
            return {
                kind: 'scan',
                exact: Object.keys(filter).length === 0,
                reverse: Number(hint.$natural) < 0
            }
        if (hint) {
            const [path] = Object.keys(hint.key)
            const [conditionPath, condition] = this.conditionOf(hint, conditions) ?? []
            const plan = (condition && this.indexPlan(hint, conditionPath!, condition)) || {
                kind: 'index' as const,
                index: hint.name,
                ranges: [{}],
                exact: false,
                multikey: this.isMultikey(hint)
            }
            plan.exact =
                plan.exact &&
                alone &&
                !!condition?.complete &&
                Object.keys(hint.key).length === 1 &&
                fields[0] === path &&
                !hint.partialFilterExpression &&
                !hint.sparse
            return plan
        }
        const ids = conditions.get('_id')
        if (ids && ids.kind === 'equal')
            return { kind: 'id', ids: ids.values, exact: alone && ids.complete }
        let best: { plan: EmbeddedPlan, score: number } | undefined
        for (const index of [this.idIndex(), ...this.collection.indexes]) {
            if (index.hidden || index.partialFilterExpression) continue
            const [path] = Object.keys(index.key)
            const [conditionPath, condition] = this.conditionOf(index, conditions) ?? []
            if (!condition) continue
            const plan = this.indexPlan(index, conditionPath!, condition)
            if (!plan) continue
            plan.exact =
                plan.exact &&
                alone &&
                condition.complete &&
                Object.keys(index.key).length === 1 &&
                fields[0] === path
            const score =
                condition.kind === 'equal' ? (index.unique ? 3 : 2) : 1
            if (!best || score > best.score) best = { plan: plan, score: score }
        }
        return (
            best?.plan ?? {
                kind: 'scan',
                exact: Object.keys(filter).length === 0
            }
        )
    }

    /**
     * The index giving the documents in the order of a sort of one field, if any: an ascending or descending index of
     * that field first, of which no document has several keys, not sparse nor partial nor hidden (the documents missing
     * the field are sorted too), not hashed nor wildcard; the index of the _id for a sort of the _id. Its walk is
     * reversed when the sort is in the other direction.
     *
     * @param sort
     */
    sortIndex(
        sort: EmbeddedDocument | undefined
    ): { index: string, reverse: boolean } | undefined {
        if (!sort) return undefined
        const fields = Object.keys(sort)
        if (fields.length !== 1) return undefined
        const direction = sort[fields[0]] === -1 || sort[fields[0]] === '-1' ? -1 : 1
        if (fields[0] === '_id') return { index: ID_INDEX, reverse: direction !== 1 }
        for (const index of this.collection.indexes) {
            const [path] = Object.keys(index.key)
            const indexDirection = this.directionOf(index.key[path])
            if (
                path !== fields[0] ||
                !indexDirection ||
                index.sparse ||
                index.partialFilterExpression ||
                index.hidden ||
                this.collection.multikey.has(index.name)
            )
                continue
            return { index: index.name, reverse: direction !== indexDirection }
        }
        return undefined
    }

    /**
     * The index of the _id, as the planner sees it: its table is the one of the collection.
     */
    idIndex(): EmbeddedIndex {
        return { name: ID_INDEX, key: { _id: 1 }, unique: true }
    }

    /**
     * Whether a document may have several keys in an index (a wildcard index: always).
     *
     * @param index
     */
    isMultikey(index: EmbeddedIndex): boolean {
        return wildcardOf(index) !== undefined || this.collection.multikey.has(index.name)
    }

    /**
     * The direction of a field of an index: 1, -1, or 0 for a field of another kind ("hashed").
     *
     * @param direction
     */
    protected directionOf(direction: any): number {
        if (direction === -1 || direction === '-1') return -1
        if (typeof direction === 'number' && direction > 0) return 1
        return 0
    }

    /**
     * The condition of a filter on which an index may be used, and its path: the one of its first field; for a wildcard
     * index, the first one of a field it holds whose path is not the one of an item of an array.
     *
     * @param index
     * @param conditions
     */
    protected conditionOf(
        index: EmbeddedIndex,
        conditions: Map<string, Condition>
    ): [string, Condition] | undefined {
        const [first] = Object.keys(index.key)
        if (!isWildcardField(first)) {
            const condition = conditions.get(first)
            return condition ? [first, condition] : undefined
        }
        for (const [path, condition] of conditions)
            if (!path.split('.').some((name) => /^\d+$/.test(name)) && wildcardHolds(index, path))
                return [path, condition]
        return undefined
    }

    /**
     * The plan of a condition on the first field of an index (on a field of a wildcard index: its path), if it may be
     * used.
     *
     * @param index
     * @param path
     * @param condition
     */
    protected indexPlan(
        index: EmbeddedIndex,
        path: string,
        condition: Condition
    ): EmbeddedPlan | undefined {
        const encoding = this.collection.encoding
        const [first] = Object.keys(index.key)
        const direction = index.key[first]
        const multikey = this.isMultikey(index)
        const wildcard = wildcardOf(index) !== undefined
        // The entries of a wildcard term start with the path of their value
        const prefix = isWildcardField(first) ? encoding.encode(path) : Buffer.alloc(0)
        const hashed = direction === 'hashed'
        if (condition.kind === 'equal') {
            const ranges: EmbeddedRange[] = []
            for (const value of condition.values) {
                const key = hashed
                    ? encoding.hash(value)
                    : encoding.direct(Buffer.concat([prefix, encoding.encode(value)]), direction)
                const end = after(key)
                ranges.push({
                    lower: { key: key, inclusive: true },
                    upper: end ? { key: end, inclusive: false } : undefined
                })
            }
            ranges.sort((a, b) => Buffer.compare(a.lower!.key, b.lower!.key))
            return {
                kind: 'index',
                index: index.name,
                // Each value once (a $in may repeat one, 1 and 1.0 are one key): the ranges of the values, each one
                // the keys of its prefix (self-delimiting), do not overlap
                ranges: ranges.filter(
                    (range, position) =>
                        !position ||
                        Buffer.compare(
                            range.lower!.key,
                            ranges[position - 1].lower!.key
                        ) !== 0
                ),
                exact: !hashed && !wildcard,
                multikey: multikey
            }
        }
        if (this.directionOf(direction) !== 1) return undefined
        let { lower, upper } = condition
        let exact = !wildcard
        // The items of an array may meet the two bounds apart: one of them is kept
        if (multikey && lower && upper) {
            upper = undefined
            exact = false
        }
        const bound = (lower ?? upper)!.value
        const tag = encoding.encode(bound)[0]
        const range: EmbeddedRange = {}
        if (lower) {
            const key = Buffer.concat([prefix, encoding.encode(lower.value)])
            range.lower = lower.inclusive
                ? { key: key, inclusive: true }
                : { key: after(key)!, inclusive: true }
        } else range.lower = { key: Buffer.concat([prefix, Buffer.of(tag)]), inclusive: true }
        if (upper && encoding.encode(upper.value)[0] === tag) {
            const key = Buffer.concat([prefix, encoding.encode(upper.value)])
            const end = after(key)
            range.upper = upper.inclusive
                ? end
                    ? { key: end, inclusive: false }
                    : undefined
                : { key: key, inclusive: false }
        } else {
            // The values of the type of the bound only, as MongoDB compares them
            range.upper = { key: Buffer.concat([prefix, Buffer.of(tag + 1)]), inclusive: false }
            if (upper) exact = false
        }
        return {
            kind: 'index',
            index: index.name,
            ranges: [range],
            exact: exact,
            multikey: multikey
        }
    }

    /**
     * The conditions of the fields of a filter (its fields, and the ones of the objects of its $and) on which an index
     * may be used.
     *
     * @param filter
     */
    protected conditionsOf(filter: EmbeddedDocument): Map<string, Condition> {
        const conditions = new Map<string, Condition>()
        const add = (query: EmbeddedDocument) => {
            for (const path of Object.keys(query)) {
                if (path === '$and' && Array.isArray(query.$and)) {
                    for (const item of query.$and)
                        if (this.isPlainObject(item)) add(item)
                    continue
                }
                if (path.startsWith('$') || conditions.has(path)) continue
                const condition = this.conditionOfValue(query[path])
                if (condition) conditions.set(path, condition)
            }
        }
        add(filter)
        return conditions
    }

    /**
     * The condition of a value of a filter on which an index may be used, if any.
     *
     * @param value
     */
    protected conditionOfValue(value: any): Condition | undefined {
        const encoding = this.collection.encoding
        const usable = (item: any) =>
            item !== null && item !== undefined && encoding.isOrdered(item)
        if (!this.isPlainObject(value))
            return usable(value)
                ? { kind: 'equal', values: [value], complete: true }
                : undefined
        const operators = Object.keys(value)
        // An object compared as it is, not by operators
        if (!operators.length || operators.some((key) => !key.startsWith('$')))
            return undefined
        if ('$eq' in value && usable(value.$eq))
            return {
                kind: 'equal',
                values: [value.$eq],
                complete: operators.length === 1
            }
        if (
            Array.isArray(value.$in) &&
            value.$in.length &&
            value.$in.every(usable)
        )
            return {
                kind: 'equal',
                values: value.$in,
                complete: operators.length === 1
            }
        const range: Extract<Condition, { kind: 'range' }> = {
            kind: 'range',
            complete: true
        }
        for (const operator of operators) {
            if (!RANGE_OPERATORS.includes(operator) || !usable(value[operator])) {
                range.complete = false
                continue
            }
            const bound = {
                value: value[operator],
                inclusive: operator.endsWith('e')
            }
            if (operator.startsWith('$g')) {
                if (range.lower) range.complete = false
                range.lower ??= bound
            } else {
                if (range.upper) range.complete = false
                range.upper ??= bound
            }
        }
        return range.lower || range.upper ? range : undefined
    }

    protected isPlainObject(value: any): boolean {
        if (value === null || typeof value !== 'object') return false
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}
