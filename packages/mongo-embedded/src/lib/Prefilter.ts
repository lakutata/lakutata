import {Comparison, type NativePredicate} from './Native.js'
import {type EmbeddedDocument} from './Values.js'

const COMPARISONS: Record<string, Comparison> = {
    $gt: Comparison.Greater,
    $gte: Comparison.GreaterOrEqual,
    $lt: Comparison.Less,
    $lte: Comparison.LessOrEqual,
    $eq: Comparison.Equal,
    $ne: Comparison.NotEqual
}

function isPlain(value: unknown): value is EmbeddedDocument {
    if (value === null || typeof value !== 'object') return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * The predicates of the prefilter of the scans of a filter (native/prefilter.h): its top-level fields (not the
 * operators, no dotted path) compared with numbers, by an equality or by the operators $gt, $gte, $lt, $lte, $eq and
 * $ne. The fields of a filter are all to be matched, so a document failing one of them does not match the filter; the
 * other conditions are left to mingo, which tests every document given.
 * @param filter
 * @internal
 */
export function predicatesOf(filter: EmbeddedDocument): NativePredicate[] {
    const predicates: NativePredicate[] = []
    for (const field of Object.keys(filter)) {
        if (field.startsWith('$') || field.includes('.') || field.includes('\0')) continue
        const condition: unknown = filter[field]
        if (typeof condition === 'number') {
            if (!Number.isNaN(condition)) predicates.push([field, Comparison.Equal, condition])
            continue
        }
        if (!isPlain(condition)) continue
        //An object of operators only (an object without them is an equality to a document)
        const operators: string[] = Object.keys(condition)
        if (!operators.length || !operators.every((operator: string): boolean => operator.startsWith('$'))) continue
        for (const operator of operators) {
            const comparison: Comparison | undefined = COMPARISONS[operator]
            const value: unknown = condition[operator]
            if (comparison !== undefined && typeof value === 'number' && !Number.isNaN(value)) predicates.push([field, comparison, value])
        }
    }
    return predicates
}
