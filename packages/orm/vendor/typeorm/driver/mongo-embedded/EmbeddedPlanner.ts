import type { EmbeddedBound } from "./EmbeddedBTree"
import type {
    EmbeddedCollectionStore,
    EmbeddedIndex,
} from "./EmbeddedCollectionStore"
import type { EmbeddedDocument } from "./EmbeddedValues"

/**
 * lakutata: a range of the keys of an index.
 */
export interface EmbeddedRange {
    lower?: EmbeddedBound
    upper?: EmbeddedBound
}

/**
 * lakutata: how the documents a filter may match are found: by their _id, by the ranges of an index, or by a scan of
 * the collection. Every document the filter matches is among them (the filter tests them then). An exact plan gives
 * the documents the filter matches and no other, once each (a count needs no document).
 */
export type EmbeddedPlan =
    | { kind: "id"; ids: any[]; exact: boolean }
    | {
          kind: "index"
          index: string
          ranges: EmbeddedRange[]
          exact: boolean
          multikey: boolean
      }
    | { kind: "scan"; exact: boolean }

/**
 * lakutata: a condition of a field on which an index may be used: an equality, a list of values, or a range; complete
 * when it is all the condition of the field (no other operator of it left to the filter).
 */
type Condition = { complete: boolean } & (
    | { kind: "equal"; values: any[] }
    | {
          kind: "range"
          lower?: { value: any; inclusive: boolean }
          upper?: { value: any; inclusive: boolean }
      }
)

/**
 * lakutata: the range operators of the queries of MongoDB.
 */
const RANGE_OPERATORS = ["$gt", "$gte", "$lt", "$lte"]

/**
 * lakutata: the smallest bytes greater than all the bytes starting with some (undefined when they are all 0xff).
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
 * lakutata: plans the queries of a collection: the conditions of the fields of a filter (its fields and the ones of its
 * $and) on which its indexes may be used, without dropping a document the filter matches. An index is used for the
 * equalities and the lists of values ($eq, $in) of the values of a type it orders, other than null (which matches the
 * documents missing the field), and for the ranges of an ascending index ($gt, $gte, $lt, $lte); the other operators
 * ($ne, $nin, $not, $exists, $regex...) are left to the filter. An index of which a document has several keys keeps
 * one bound of a range (its two bounds may be met by different items of an array), the filter testing the documents.
 */
export class EmbeddedPlanner {
    constructor(protected readonly collection: EmbeddedCollectionStore) {}

    /**
     * The plan of a filter.
     *
     * @param filter
     */
    plan(filter: EmbeddedDocument): EmbeddedPlan {
        const conditions = this.conditionsOf(filter)
        const fields = Object.keys(filter).filter((key) => !key.startsWith("$"))
        const alone = fields.length === 1 && Object.keys(filter).length === 1
        const ids = conditions.get("_id")
        if (ids && ids.kind === "equal")
            return { kind: "id", ids: ids.values, exact: alone && ids.complete }
        let best: { plan: EmbeddedPlan; score: number } | undefined
        for (const index of this.collection.indexes) {
            const [path] = Object.keys(index.key)
            const condition = conditions.get(path)
            if (!condition) continue
            const plan = this.indexPlan(index, condition)
            if (!plan) continue
            plan.exact =
                alone &&
                condition.complete &&
                Object.keys(index.key).length === 1 &&
                fields[0] === path &&
                plan.exact
            const score =
                condition.kind === "equal" ? (index.unique ? 3 : 2) : 1
            if (!best || score > best.score) best = { plan: plan, score: score }
        }
        return (
            best?.plan ?? {
                kind: "scan",
                exact: Object.keys(filter).length === 0,
            }
        )
    }

    /**
     * The index giving the documents in the order of a sort of one field, if any: an ascending or descending index of
     * that field first, of which no document has several keys, not sparse (the documents missing the field are
     * sorted too). Its walk is reversed when the sort is in the other direction.
     *
     * @param sort
     */
    sortIndex(
        sort: EmbeddedDocument | undefined,
    ): { index: string; reverse: boolean } | undefined {
        if (!sort) return undefined
        const fields = Object.keys(sort)
        if (fields.length !== 1) return undefined
        const direction = sort[fields[0]] === -1 || sort[fields[0]] === "-1" ? -1 : 1
        for (const index of this.collection.indexes) {
            const [path] = Object.keys(index.key)
            if (
                path !== fields[0] ||
                index.sparse ||
                this.collection.multikey.has(index.name)
            )
                continue
            const indexDirection =
                index.key[path] === -1 || index.key[path] === "-1" ? -1 : 1
            return { index: index.name, reverse: direction !== indexDirection }
        }
        return undefined
    }

    /**
     * The plan of a condition on the first field of an index, if it may be used.
     *
     * @param index
     * @param condition
     */
    protected indexPlan(
        index: EmbeddedIndex,
        condition: Condition,
    ): EmbeddedPlan | undefined {
        const encoding = this.collection.encoding
        const [path] = Object.keys(index.key)
        const descending = index.key[path] === -1 || index.key[path] === "-1"
        const multikey = this.collection.multikey.has(index.name)
        if (condition.kind === "equal") {
            const ranges: EmbeddedRange[] = []
            for (const value of condition.values) {
                const prefix = encoding.direct(
                    encoding.encode(value),
                    index.key[path],
                )
                const end = after(prefix)
                ranges.push({
                    lower: { key: prefix, inclusive: true },
                    upper: end ? { key: end, inclusive: false } : undefined,
                })
            }
            ranges.sort((a, b) => Buffer.compare(a.lower!.key, b.lower!.key))
            return {
                kind: "index",
                index: index.name,
                // Each value once (a $in may repeat one, 1 and 1.0 are one key): the ranges of the values, each one
                // the keys of its prefix (self-delimiting), do not overlap
                ranges: ranges.filter(
                    (range, position) =>
                        !position ||
                        Buffer.compare(
                            range.lower!.key,
                            ranges[position - 1].lower!.key,
                        ) !== 0,
                ),
                exact: true,
                multikey: multikey,
            }
        }
        if (descending) return undefined
        let { lower, upper } = condition
        let exact = true
        // The items of an array may meet the two bounds apart: one of them is kept
        if (multikey && lower && upper) {
            upper = undefined
            exact = false
        }
        const bound = (lower ?? upper)!.value
        const tag = encoding.encode(bound)[0]
        const range: EmbeddedRange = {}
        if (lower) {
            const key = encoding.encode(lower.value)
            range.lower = lower.inclusive
                ? { key: key, inclusive: true }
                : { key: after(key)!, inclusive: true }
        } else range.lower = { key: Buffer.of(tag), inclusive: true }
        if (upper && encoding.encode(upper.value)[0] === tag) {
            const key = encoding.encode(upper.value)
            const end = after(key)
            range.upper = upper.inclusive
                ? end
                    ? { key: end, inclusive: false }
                    : undefined
                : { key: key, inclusive: false }
        } else {
            // The values of the type of the bound only, as MongoDB compares them
            range.upper = { key: Buffer.of(tag + 1), inclusive: false }
            if (upper) exact = false
        }
        return {
            kind: "index",
            index: index.name,
            ranges: [range],
            exact: exact,
            multikey: multikey,
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
                if (path === "$and" && Array.isArray(query.$and)) {
                    for (const item of query.$and)
                        if (this.isPlainObject(item)) add(item)
                    continue
                }
                if (path.startsWith("$") || conditions.has(path)) continue
                const condition = this.conditionOf(query[path])
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
    protected conditionOf(value: any): Condition | undefined {
        const encoding = this.collection.encoding
        const usable = (item: any) =>
            item !== null && item !== undefined && encoding.isOrdered(item)
        if (!this.isPlainObject(value))
            return usable(value)
                ? { kind: "equal", values: [value], complete: true }
                : undefined
        const operators = Object.keys(value)
        // An object compared as it is, not by operators
        if (!operators.length || operators.some((key) => !key.startsWith("$")))
            return undefined
        if ("$eq" in value && usable(value.$eq))
            return {
                kind: "equal",
                values: [value.$eq],
                complete: operators.length === 1,
            }
        if (
            Array.isArray(value.$in) &&
            value.$in.length &&
            value.$in.every(usable)
        )
            return {
                kind: "equal",
                values: value.$in,
                complete: operators.length === 1,
            }
        const range: Extract<Condition, { kind: "range" }> = {
            kind: "range",
            complete: true,
        }
        for (const operator of operators) {
            if (!RANGE_OPERATORS.includes(operator) || !usable(value[operator])) {
                range.complete = false
                continue
            }
            const bound = {
                value: value[operator],
                inclusive: operator.endsWith("e"),
            }
            if (operator.startsWith("$g")) {
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
        if (value === null || typeof value !== "object") return false
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}
