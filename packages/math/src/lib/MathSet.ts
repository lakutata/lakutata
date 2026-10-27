import {MathNotSupportedException} from '../exceptions/MathNotSupportedException.js'
import type {Context} from './Context.js'
import {Expression, handleOf, type Value} from './Expression.js'

/**
 * An interval of a set of numbers: its ends, exact (`-inf` and `inf` where it has none), and whether each one is
 * excluded
 */
export interface SetInterval {
    /**
     * Its start (`-inf` without one).
     */
    start: Expression
    /**
     * Its end (`inf` without one).
     */
    end: Expression
    /**
     * Whether the start is excluded.
     */
    startOpen: boolean
    /**
     * Whether the end is excluded.
     */
    endOpen: boolean
}

/**
 * What a set is: empty, some values, intervals of real numbers (with values apart from them), every value, or a set
 * described in text, which the operations do not take
 */
export type MathSetKind = 'empty' | 'finite' | 'intervals' | 'all' | 'other'

/**
 * Whether the ends of an interval are excluded: both are included by default
 */
export interface IntervalOptions {
    /**
     * Whether the start is excluded.
     */
    startOpen?: boolean
    /**
     * Whether the end is excluded.
     */
    endOpen?: boolean
}

//The order of two real values: -1, 0 or 1, an exception where it is not known
function order(a: Expression, b: Expression): number {
    const found: number | undefined = a.compare(b)
    if (found === undefined) throw new MathNotSupportedException(`${a.toString()} and ${b.toString()} cannot be ordered`)
    return found
}

//Whether a value can be ordered with the real numbers: real, or without variables and compared with 0 (a real root
//written with complex parts, as Cardano's formula writes it)
function real(value: Expression): boolean {
    return value.isReal() === true || (value.variables().length === 0 && value.compare(0) !== undefined)
}

//Whether two values are equal: by isZero() of their difference, else by compare() where they are real; undefined
//where neither tells
function sameValue(a: Expression, b: Expression): boolean | undefined {
    const zero: boolean | undefined = a.sub(b).isZero()
    if (zero !== undefined) return zero
    if (!real(a) || !real(b)) return undefined
    const found: number | undefined = a.compare(b)
    return found === undefined ? undefined : found === 0
}

//Whether a value is inside an interval
function inside(value: Expression, interval: SetInterval): boolean {
    const start: number = order(value, interval.start), end: number = order(value, interval.end)
    return (start > 0 || (start === 0 && !interval.startOpen)) && (end < 0 || (end === 0 && !interval.endOpen))
}

//Intervals sorted and merged where they overlap or touch at an end that one of them includes
function merged(intervals: SetInterval[]): SetInterval[] {
    const sorted: SetInterval[] = [...intervals].sort((x: SetInterval, y: SetInterval): number => order(x.start, y.start) || Number(x.startOpen) - Number(y.startOpen))
    const result: SetInterval[] = []
    for (const interval of sorted) {
        const last: SetInterval | undefined = result[result.length - 1]
        if (last) {
            const gap: number = order(last.end, interval.start)
            if (gap > 0 || (gap === 0 && !(last.endOpen && interval.startOpen))) {
                const end: number = order(interval.end, last.end)
                if (end > 0) result[result.length - 1] = {...last, end: interval.end, endOpen: interval.endOpen}
                else if (end === 0) result[result.length - 1] = {...last, endOpen: last.endOpen && interval.endOpen}
                continue
            }
        }
        result.push({...interval})
    }
    return result
}

/**
 * A set of numbers: some values, intervals of real numbers with exact ends, every value, or a set described in text
 * (the periodic solutions of an equation). Its intervals are sorted and apart, its values outside them (the real ones
 * sorted). It is immutable: each operation gives a new set. The operations compare the ends exactly (`compare()`): a
 * set with variables in its ends throws `MathNotSupportedException` where they cannot be ordered.
 * @example
 * ```typescript
 * import {finiteSet, interval} from '@lakutata/math'
 *
 * const set = interval(0, 2, {endOpen: true}).union(finiteSet([3]))
 * console.log(set.toString())                    //[0, 2) ∪ {3}
 * console.log(set.complement().toString())       //(-inf, 0) ∪ [2, 3) ∪ (3, inf)
 * console.log(set.contains('sqrt(2)'))           //true
 * ```
 */
export class MathSet {

    /**
     * What the set is.
     */
    public readonly kind: MathSetKind

    /**
     * A set of values and intervals, as they are given (sorted and apart: `interval()`, `finiteSet()` and the
     * operations make them so).
     * @param context The context of the formulas.
     * @param values The values outside the intervals.
     * @param intervals The intervals.
     * @param kind What the set is (from the values and the intervals by default).
     * @param text The description of a set of the kind `other`.
     */
    constructor(protected readonly context: Context, public readonly values: readonly Expression[] = [], public readonly intervals: readonly SetInterval[] = [], kind?: MathSetKind, public readonly text?: string) {
        this.kind = kind ?? (intervals.length > 0 ? 'intervals' : values.length > 0 ? 'finite' : 'empty')
    }

    #expression(value: Value): Expression {
        return new Expression(this.context, handleOf(this.context, value))
    }

    #set(values: Expression[], intervals: SetInterval[], kind?: MathSetKind): MathSet {
        return new MathSet(this.context, values, intervals, kind)
    }

    //The set of the values and the intervals in their order: the empty intervals dropped, a point alone as a value, the
    //infinite ends excluded, the values inside an interval or at its ends taken by it
    #normalized(values: Expression[], intervals: SetInterval[]): MathSet {
        const negative: Expression = this.#expression('-inf'), positive: Expression = this.#expression('inf')
        const points: Expression[] = [...values]
        const parts: SetInterval[] = []
        for (const interval of intervals) {
            const startOpen: boolean = interval.startOpen || order(interval.start, negative) === 0
            const endOpen: boolean = interval.endOpen || order(interval.end, positive) === 0
            const size: number = order(interval.start, interval.end)
            if (size > 0) continue
            if (size === 0) {
                if (!startOpen && !endOpen) points.push(interval.start)
                continue
            }
            parts.push({start: interval.start, end: interval.end, startOpen, endOpen})
        }
        let result: SetInterval[] = merged(parts)
        const kept: Expression[] = []
        for (const point of points) {
            if (real(point)) {
                const at: number = result.findIndex((interval: SetInterval): boolean => inside(point, interval) || order(point, interval.start) === 0 || order(point, interval.end) === 0)
                if (at >= 0) {
                    const interval: SetInterval = result[at]!
                    result[at] = {...interval, startOpen: interval.startOpen && order(point, interval.start) !== 0, endOpen: interval.endOpen && order(point, interval.end) !== 0}
                    continue
                }
            }
            if (!kept.some((other: Expression): boolean => sameValue(other, point) === true)) kept.push(point)
        }
        result = merged(result)
        const ordered: Expression[] = kept.filter(real).sort(order)
        const others: Expression[] = kept.filter((point: Expression): boolean => !real(point))
        return this.#set([...ordered, ...others], result)
    }

    #operable(other?: MathSet): void {
        if (this.kind === 'other' || other?.kind === 'other') throw new MathNotSupportedException(`The operations of sets do not take ${(this.kind === 'other' ? this : other!).toString()}`)
    }

    /**
     * Whether the set has no element.
     */
    public isEmpty(): boolean {
        return this.kind === 'empty'
    }

    /**
     * Whether a value is in the set: `undefined` where it is not known (a value with variables, a set of the kind
     * `other`).
     * @param value The value: an expression, a number or a formula.
     */
    public contains(value: Value): boolean | undefined {
        if (this.kind === 'all') return true
        if (this.kind === 'other') return undefined
        const element: Expression = this.#expression(value)
        let unknown: boolean = false
        for (const point of this.values) {
            const same: boolean | undefined = sameValue(point, element)
            if (same === true) return true
            if (same === undefined) unknown = true
        }
        if (this.intervals.length === 0) return unknown ? undefined : false
        if (element.isReal() === false) return unknown ? undefined : false
        for (const interval of this.intervals) {
            const start: number | undefined = element.compare(interval.start), end: number | undefined = element.compare(interval.end)
            if (start === undefined || end === undefined) {
                unknown = true
                continue
            }
            if ((start > 0 || (start === 0 && !interval.startOpen)) && (end < 0 || (end === 0 && !interval.endOpen))) return true
        }
        return unknown ? undefined : false
    }

    /**
     * The union with another set.
     * @param other The other set.
     */
    public union(other: MathSet): MathSet {
        this.#operable(other)
        if (this.kind === 'all' || other.kind === 'all') return this.#set([], [], 'all')
        return this.#normalized([...this.values, ...other.values], [...this.intervals, ...other.intervals])
    }

    /**
     * The intersection with another set.
     * @param other The other set.
     */
    public intersect(other: MathSet): MathSet {
        this.#operable(other)
        if (this.kind === 'all') return other
        if (other.kind === 'all') return this
        const intervals: SetInterval[] = []
        for (const a of this.intervals) {
            for (const b of other.intervals) {
                const start: number = order(a.start, b.start), end: number = order(a.end, b.end)
                intervals.push({
                    start: start >= 0 ? a.start : b.start,
                    startOpen: start > 0 ? a.startOpen : start < 0 ? b.startOpen : a.startOpen || b.startOpen,
                    end: end <= 0 ? a.end : b.end,
                    endOpen: end < 0 ? a.endOpen : end > 0 ? b.endOpen : a.endOpen || b.endOpen
                })
            }
        }
        const values: Expression[] = []
        for (const [set, from] of [[other, this], [this, other]] as const) {
            for (const point of from.values) {
                const found: boolean | undefined = set.contains(point)
                if (found === undefined) throw new MathNotSupportedException(`Whether ${point.toString()} is in ${set.toString()} is not known`)
                if (found) values.push(point)
            }
        }
        return this.#normalized(values, intervals)
    }

    /**
     * The complement in the real numbers: the values of the set that are not real play no part in it.
     */
    public complement(): MathSet {
        this.#operable()
        if (this.kind === 'all') return this.#set([], [])
        const gaps: SetInterval[] = []
        let start: Expression = this.#expression('-inf'), startOpen: boolean = true
        for (const interval of this.intervals) {
            gaps.push({start, end: interval.start, startOpen, endOpen: !interval.startOpen})
            start = interval.end
            startOpen = !interval.endOpen
        }
        gaps.push({start, end: this.#expression('inf'), startOpen, endOpen: true})
        //A gap of one point between two intervals that exclude it ((-inf, 0) and (0, inf)) is a value
        const between: MathSet = this.#normalized([], gaps)
        let result: SetInterval[] = [...between.intervals]
        //The real values taken out: the interval with one split there
        for (const point of this.values) {
            if (!real(point)) continue
            result = result.flatMap((interval: SetInterval): SetInterval[] => inside(point, interval) ? [{...interval, end: point, endOpen: true}, {...interval, start: point, startOpen: true}] : [interval])
        }
        const values: Expression[] = between.values.filter((value: Expression): boolean => !this.values.some((point: Expression): boolean => sameValue(point, value) === true))
        return this.#normalized(values, result)
    }

    /**
     * The elements of the set that are not in another one.
     * @param other The other set.
     */
    public difference(other: MathSet): MathSet {
        this.#operable(other)
        if (other.kind === 'all') return this.#set([], [])
        if (this.kind === 'all') return other.complement()
        //The intervals in the complement (a point where they meet it at one end), the values not in the other set
        const part: MathSet = this.#set([], [...this.intervals]).intersect(other.complement())
        const values: Expression[] = this.values.filter((point: Expression): boolean => {
            const found: boolean | undefined = other.contains(point)
            if (found === undefined) throw new MathNotSupportedException(`Whether ${point.toString()} is in ${other.toString()} is not known`)
            return !found
        })
        return this.#normalized([...part.values, ...values], [...part.intervals])
    }

    /**
     * Whether the set has the same elements as another one.
     * @param other The other set.
     */
    public equals(other: MathSet): boolean {
        if (this.kind !== other.kind) return false
        if (this.kind === 'other') return this.text === other.text
        if (this.values.length !== other.values.length || this.intervals.length !== other.intervals.length) return false
        const same = (a: Expression, b: Expression): boolean => sameValue(a, b) === true
        return this.values.every((value: Expression): boolean => other.values.some((theirs: Expression): boolean => same(value, theirs)))
            && this.intervals.every((interval: SetInterval, i: number): boolean => {
                const theirs: SetInterval = other.intervals[i]!
                return same(interval.start, theirs.start) && same(interval.end, theirs.end) && interval.startOpen === theirs.startOpen && interval.endOpen === theirs.endOpen
            })
    }

    //The parts in their order: the intervals, and the values between them grouped
    #parts(interval: (part: SetInterval) => string, group: (values: string[]) => string, value: (part: Expression) => string): string[] {
        const parts: string[] = []
        const pending: Expression[] = [...this.values]
        const flush = (before?: SetInterval): void => {
            const taken: Expression[] = []
            while (pending.length > 0 && real(pending[0]!) && (before === undefined || pending[0]!.compare(before.start) === -1)) taken.push(pending.shift()!)
            if (before === undefined) taken.push(...pending.splice(0))
            if (taken.length > 0) parts.push(group(taken.map(value)))
        }
        for (const part of this.intervals) {
            flush(part)
            parts.push(interval(part))
        }
        flush()
        return parts
    }

    /**
     * The set in the notation of intervals: `(-inf, -1] ∪ {0} ∪ [1, 2)`; `{}` for the empty set, `every value`, or the
     * description of a set of the kind `other`.
     */
    public toString(): string {
        if (this.kind === 'empty') return '{}'
        if (this.kind === 'all') return 'every value'
        if (this.kind === 'other') return this.text ?? ''
        return this.#parts(
            (part: SetInterval): string => `${part.startOpen ? '(' : '['}${part.start.toString()}, ${part.end.toString()}${part.endOpen ? ')' : ']'}`,
            (values: string[]): string => `{${values.join(', ')}}`,
            (part: Expression): string => part.toString()
        ).join(' ∪ ')
    }

    /**
     * The set, for `JSON.stringify()`.
     */
    public toJSON(): string {
        return this.toString()
    }

    /**
     * The LaTeX of the set: `\left(-\infty, -1\right] \cup \left\{0\right\}`, `\emptyset`.
     */
    public toTeX(): string {
        if (this.kind === 'empty') return '\\emptyset'
        if (this.kind === 'all') return '\\text{every value}'
        if (this.kind === 'other') return `\\text{${this.text ?? ''}}`
        return this.#parts(
            (part: SetInterval): string => `\\left${part.startOpen ? '(' : '['}${part.start.toTeX()}, ${part.end.toTeX()}\\right${part.endOpen ? ')' : ']'}`,
            (values: string[]): string => `\\left\\{${values.join(', ')}\\right\\}`,
            (part: Expression): string => part.toTeX()
        ).join(' \\cup ')
    }
}

/**
 * An interval of real numbers, in a context: empty when the start is after the end, a value when they are equal.
 * @param context The context of the formulas.
 * @param start The start (`-inf` for none).
 * @param end The end (`inf` for none).
 * @param options Whether the ends are excluded.
 */
export function intervalOf(context: Context, start: Value, end: Value, options: IntervalOptions = {}): MathSet {
    const empty: MathSet = new MathSet(context)
    const interval: SetInterval = {
        start: new Expression(context, handleOf(context, start)),
        end: new Expression(context, handleOf(context, end)),
        startOpen: options.startOpen ?? false,
        endOpen: options.endOpen ?? false
    }
    for (const bound of [interval.start, interval.end]) {
        if (!real(bound) && bound.isFinite() !== false) throw new MathNotSupportedException(`The end ${bound.toString()} of an interval is not a real number`)
    }
    return empty.union(new MathSet(context, [], [interval]))
}

/**
 * A finite set of values, in a context: each one once, the real ones sorted, then the others as they are given.
 * @param context The context of the formulas.
 * @param values The values.
 */
export function finiteSetOf(context: Context, values: readonly Value[]): MathSet {
    const expressions: Expression[] = values.map((value: Value): Expression => new Expression(context, handleOf(context, value)))
    return new MathSet(context).union(new MathSet(context, expressions, []))
}
