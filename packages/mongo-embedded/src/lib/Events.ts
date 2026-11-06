import {type EmbeddedDocument, type EmbeddedValues} from './Values.js'

/**
 * The description of an update in its event of a change stream (updateDescription): the fields set (their dotted
 * paths), the ones removed, the arrays truncated
 */
export interface EmbeddedUpdateDescription {
    updatedFields: EmbeddedDocument
    removedFields: string[]
    truncatedArrays: { field: string, newSize: number }[]
}

/**
 * The bytes MongoDB adds to the diff of an update by a pipeline before it compares it with the document: an update
 * whose diff is not smaller than the document is a replacement (update_oplog_entry::kSizeOfDeltaOplogEntryMetadata;
 * measured between 9 and 19 on MongoDB 8.0)
 */
const DELTA_METADATA: number = 15

/**
 * Whether a value is a document (not an array, not a value of BSON)
 * @param value
 */
function isDocument(value: unknown): value is EmbeddedDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * The value at a path of a document: missing (undefined) when a component is not there; the components of an array
 * its indexes
 * @param document
 * @param parts
 */
function valueAt(document: unknown, parts: string[]): unknown {
    let value: unknown = document
    for (const part of parts) {
        if (Array.isArray(value)) {
            if (!/^\d+$/.test(part)) return undefined
            value = value[Number(part)]
        } else if (isDocument(value)) {
            if (!Object.prototype.hasOwnProperty.call(value, part)) return undefined
            value = value[part]
        } else {
            return undefined
        }
        if (value === undefined) return undefined
    }
    return value
}

/**
 * The comparisons of values as MongoDB tells a write a change: by their BSON (1 and 1.0 the same, Long(1) another)
 */
class Sameness {
    constructor(protected readonly values: EmbeddedValues) {
    }

    same(a: unknown, b: unknown): boolean {
        if (a === b) return typeof a !== 'number' || !Object.is(a, -0) === !Object.is(b, -0)
        if (a === undefined || b === undefined) return false
        return this.values.serialize({v: a}).equals(this.values.serialize({v: b}))
    }

    size(value: unknown): number {
        return this.values.serialize({v: value}).length - 8
    }
}

/**
 * The fields logged by an update of operators, as MongoDB logs them (its update nodes, in the order of their paths)
 */
class Log {
    readonly updated: Map<string, unknown> = new Map<string, unknown>()
    readonly removed: string[] = []

    description(): EmbeddedUpdateDescription | undefined {
        if (!this.updated.size && !this.removed.length) return undefined
        const paths: string[] = [...this.updated.keys()].sort()
        return {
            updatedFields: Object.fromEntries(paths.map((path: string): [string, unknown] => [path, this.updated.get(path)])),
            removedFields: [...this.removed].sort(),
            truncatedArrays: []
        }
    }
}

/**
 * The description of an update of operators ($set, $inc, $push...) of a document, as MongoDB 8.0 logs it (measured):
 * each operator logs its path whole (a document set whole, not its fields); a path created logs its first component
 * missing; an array grown at its end by $push or $addToSet logs its new items, other changes of an array log it whole;
 * $[] and $[identifier] log the one item they match through it, the item they changed when they changed one, the array
 * when they changed more; $ logs the item it matched. Undefined when nothing changed.
 *
 * @param values
 * @param previous the document before the update
 * @param next the document after it
 * @param modifier the operators of the update
 * @param arrayFilters the filters of its identifiers
 */
export function describeModifier(values: EmbeddedValues, previous: EmbeddedDocument, next: EmbeddedDocument, modifier: EmbeddedDocument, arrayFilters?: EmbeddedDocument[]): EmbeddedUpdateDescription | undefined {
    const sameness: Sameness = new Sameness(values)
    const log: Log = new Log()
    const filters: Map<string, EmbeddedDocument> = new Map<string, EmbeddedDocument>()
    for (const filter of arrayFilters ?? []) {
        const [field] = Object.keys(filter)
        const identifier: string = field.split('.')[0]
        filters.set(identifier, {...(filters.get(identifier) ?? {}), ...filter})
    }
    /**
     * Whether an item of an array matches the filter of an identifier ($[identifier])
     */
    const matches = (identifier: string, item: unknown): boolean => {
        const filter: EmbeddedDocument | undefined = filters.get(identifier)
        if (!filter) return true
        const rewritten: EmbeddedDocument = {}
        for (const [field, condition] of Object.entries(filter)) {
            const rest: string = field.slice(identifier.length + 1)
            rewritten[rest ? `item.${rest}` : 'item'] = condition
        }
        return new values.mingo.Query(rewritten).test({item: item})
    }
    /**
     * Logs the path of an operator: its components walked (the positional ones resolved), then its leaf logged
     */
    const walk = (done: string[], parts: string[], leaf: (path: string[]) => void): void => {
        const at: number = parts.findIndex((part: string): boolean => part === '$' || /^\$\[.*\]$/.test(part))
        if (at < 0) return leaf([...done, ...parts])
        const prefix: string[] = [...done, ...parts.slice(0, at)]
        const rest: string[] = parts.slice(at + 1)
        const before: unknown = valueAt(previous, prefix)
        const after: unknown = valueAt(next, prefix)
        if (!Array.isArray(after)) return leaf(prefix)
        const items: unknown[] = Array.isArray(before) ? before : []
        const changed: number[] = after.map((_: unknown, index: number): number => index).filter((index: number): boolean => !sameness.same(items[index], after[index]))
        if (parts[at] === '$') {
            // The item the query matched: the one changed
            if (changed.length) walk([...prefix, String(changed[0])], rest, leaf)
            return
        }
        const identifier: string = parts[at].slice(2, -1)
        const matched: number[] = items.map((_: unknown, index: number): number => index).filter((index: number): boolean => identifier === '' || matches(identifier, items[index]))
        if (matched.length === 1) walk([...prefix, String(matched[0])], rest, leaf)
        else if (changed.length > 1) log.updated.set(prefix.join('.'), after)
        else if (changed.length === 1) log.updated.set([...prefix, String(changed[0])].join('.'), after[changed[0]])
    }
    /**
     * A path set: logged when its value changed; created, its first component missing
     */
    const set = (path: string[]): void => {
        const before: unknown = valueAt(previous, path)
        const after: unknown = valueAt(next, path)
        if (after === undefined || sameness.same(before, after)) return
        if (before === undefined) {
            for (let length: number = 1; length <= path.length; length++)
                if (valueAt(previous, path.slice(0, length)) === undefined) {
                    log.updated.set(path.slice(0, length).join('.'), valueAt(next, path.slice(0, length)))
                    return
                }
        }
        log.updated.set(path.join('.'), after)
    }
    const unset = (path: string[]): void => {
        if (valueAt(previous, path) !== undefined && valueAt(next, path) === undefined) log.removed.push(path.join('.'))
    }
    /**
     * An array changed by an operator: grown at its end (appended), its new items; else whole
     */
    const array = (path: string[], appended: boolean): void => {
        const before: unknown = valueAt(previous, path)
        const after: unknown = valueAt(next, path)
        if (after === undefined || sameness.same(before, after)) return
        if (before === undefined) return set(path)
        if (appended && Array.isArray(before) && Array.isArray(after) && after.length > before.length && before.every((item: unknown, index: number): boolean => sameness.same(item, after[index]))) {
            for (let index: number = before.length; index < after.length; index++) log.updated.set([...path, String(index)].join('.'), after[index])
            return
        }
        log.updated.set(path.join('.'), after)
    }
    for (const [operator, fields] of Object.entries(modifier)) {
        if (operator === '$setOnInsert' || !isDocument(fields)) continue
        for (const [field, argument] of Object.entries(fields)) {
            const parts: string[] = field.split('.')
            switch (operator) {
                case '$unset':
                    walk([], parts, unset)
                    break
                case '$rename':
                    walk([], parts, unset)
                    if (typeof argument === 'string') walk([], argument.split('.'), set)
                    break
                case '$push': {
                    const plain: boolean = !isDocument(argument) || !Object.keys(argument).some((key: string): boolean => key.startsWith('$') && key !== '$each')
                    walk([], parts, (path: string[]): void => array(path, plain))
                    break
                }
                case '$addToSet':
                    walk([], parts, (path: string[]): void => array(path, true))
                    break
                case '$pop':
                case '$pull':
                case '$pullAll':
                    walk([], parts, (path: string[]): void => array(path, false))
                    break
                default:
                    walk([], parts, set)
            }
        }
    }
    return log.description()
}

/**
 * A diff of documents in the format of the oplog of MongoDB (v2): an object (its fields deleted, updated, inserted,
 * and the diffs of its documents and arrays changed) or an array (its new size when truncated, its items updated and
 * the diffs of its items changed)
 */
type Diff = { kind: 'object', deleted: string[], updated: Map<string, unknown>, inserted: Map<string, unknown>, sub: Map<string, Diff> }
    | { kind: 'array', size?: number, updated: Map<number, unknown>, sub: Map<number, Diff> }

/**
 * The diff of documents in the format of the oplog, as BSON (its size compared with the size of the value)
 * @param diff
 */
function diffDocument(diff: Diff): EmbeddedDocument {
    if (diff.kind === 'array') {
        const document: EmbeddedDocument = {a: true}
        if (diff.size !== undefined) document.l = diff.size
        for (const [index, value] of diff.updated) document[`u${index}`] = value
        for (const [index, sub] of diff.sub) document[`s${index}`] = diffDocument(sub)
        return document
    }
    const document: EmbeddedDocument = {}
    if (diff.deleted.length) document.d = Object.fromEntries(diff.deleted.map((field: string): [string, boolean] => [field, false]))
    if (diff.updated.size) document.u = Object.fromEntries(diff.updated)
    if (diff.inserted.size) document.i = Object.fromEntries(diff.inserted)
    for (const [field, sub] of diff.sub) document[`s${field}`] = diffDocument(sub)
    return document
}

/**
 * The description of an update by a pipeline of a document, as MongoDB computes it (doc_diff): the fields of the
 * document after it compared with the ones before, in their order; a field changed in a document or an array is
 * diffed in it, unless its diff is larger than its value (set whole then); an array shorter, with its items the same,
 * truncated. A diff larger than the document (with the metadata of the oplog) is a replacement: undefined when nothing
 * changed, "replace" then.
 *
 * @param values
 * @param previous the document before the update
 * @param next the document after it
 */
export function describePipeline(values: EmbeddedValues, previous: EmbeddedDocument, next: EmbeddedDocument): EmbeddedUpdateDescription | 'replace' | undefined {
    const sameness: Sameness = new Sameness(values)
    /**
     * The diff of a value changed (in a document or an array): its diff, or the value set whole when it is smaller
     */
    const changed = (before: unknown, after: unknown): { diff?: Diff, whole?: unknown } => {
        let diff: Diff | undefined
        if (isDocument(before) && isDocument(after)) diff = objectDiff(before, after)
        else if (Array.isArray(before) && Array.isArray(after)) diff = arrayDiff(before, after)
        if (diff && sameness.size(diffDocument(diff)) <= sameness.size(after)) return {diff: diff}
        return {whole: after}
    }
    const objectDiff = (before: EmbeddedDocument, after: EmbeddedDocument): Diff => {
        const diff: Diff = {kind: 'object', deleted: [], updated: new Map<string, unknown>(), inserted: new Map<string, unknown>(), sub: new Map<string, Diff>()}
        const beforeFields: string[] = Object.keys(before)
        const afterFields: string[] = Object.keys(after)
        const deleted: Set<string> = new Set<string>()
        let i: number = 0
        let j: number = 0
        // The fields of both in the same order compared; a field of the document before out of that order deleted (and
        // inserted again at its place among the next ones, when it is there)
        while (i < beforeFields.length && j < afterFields.length) {
            if (beforeFields[i] === afterFields[j]) {
                const field: string = afterFields[j]
                if (!sameness.same(before[field], after[field])) {
                    const {diff: sub, whole} = changed(before[field], after[field])
                    if (sub) diff.sub.set(field, sub)
                    else diff.updated.set(field, whole)
                }
                i++
                j++
            } else {
                deleted.add(beforeFields[i])
                i++
            }
        }
        for (; i < beforeFields.length; i++) deleted.add(beforeFields[i])
        for (; j < afterFields.length; j++) {
            deleted.delete(afterFields[j])
            diff.inserted.set(afterFields[j], after[afterFields[j]])
        }
        diff.deleted.push(...beforeFields.filter((field: string): boolean => deleted.has(field)))
        return diff
    }
    const arrayDiff = (before: unknown[], after: unknown[]): Diff => {
        const diff: Diff = {kind: 'array', updated: new Map<number, unknown>(), sub: new Map<number, Diff>()}
        for (let index: number = 0; index < after.length; index++) {
            if (index < before.length && sameness.same(before[index], after[index])) continue
            if (index >= before.length) {
                diff.updated.set(index, after[index])
                continue
            }
            const {diff: sub, whole} = changed(before[index], after[index])
            if (sub) diff.sub.set(index, sub)
            else diff.updated.set(index, whole)
        }
        if (after.length < before.length) diff.size = after.length
        return diff
    }
    if (sameness.same(previous, next)) return undefined
    const diff: Diff = objectDiff(previous, next)
    if (sameness.size(diffDocument(diff)) + DELTA_METADATA > sameness.size(next)) return 'replace'
    const description: EmbeddedUpdateDescription = {updatedFields: {}, removedFields: [], truncatedArrays: []}
    const describe = (node: Diff, path: string[]): void => {
        if (node.kind === 'array') {
            if (node.size !== undefined) description.truncatedArrays.push({field: path.join('.'), newSize: node.size})
            for (const [index, value] of node.updated) description.updatedFields[[...path, String(index)].join('.')] = value
            for (const [index, sub] of node.sub) describe(sub, [...path, String(index)])
            return
        }
        for (const field of node.deleted) description.removedFields.push([...path, field].join('.'))
        for (const [field, value] of node.updated) description.updatedFields[[...path, field].join('.')] = value
        for (const [field, value] of node.inserted) description.updatedFields[[...path, field].join('.')] = value
        for (const [field, sub] of node.sub) describe(sub, [...path, field])
    }
    describe(diff, [])
    return description
}
