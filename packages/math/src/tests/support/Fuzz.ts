import {type Expression, Math, MathException} from '../../exports/Math.js'

/**
 * A seeded generator of random numbers (mulberry32): the same seed gives the same formulas
 */
export class Random {
    #state: number

    constructor(seed: number) {
        this.#state = seed >>> 0
    }

    public next(): number {
        this.#state = (this.#state + 0x6D2B79F5) >>> 0
        let t: number = this.#state
        t = globalThis.Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + globalThis.Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    public int(below: number): number {
        return globalThis.Math.floor(this.next() * below)
    }

    public pick<T>(values: readonly T[]): T {
        return values[this.int(values.length)]
    }

    public chance(probability: number): boolean {
        return this.next() < probability
    }
}

const NUMBERS: readonly string[] = ['0', '1', '2', '3', '5', '7', '12', '0.5', '2.25', '1e2', '3/4', '1.5e-1']
const VARIABLES: readonly string[] = ['x', 'y', 'z']
const CONSTANTS: readonly string[] = ['pi', 'e', 'i']
const SMOOTH: readonly string[] = ['sin', 'cos', 'tan', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'sqrt', 'gamma', 'erf', 'asinh', 'cbrt', 'sinc', 're', 'im']
const OTHERS: readonly string[] = ['abs', 'sign', 'floor', 'ceil', 'round', 'arg']
const EXPONENTS: readonly string[] = ['2', '3', '-1', '-2', '1/2', '1/3', '0.5', 'x', '4']

/**
 * A random formula in the syntax of the package: numbers, variables, constants, the operators (written with and
 * without their parentheses, products written without *), functions
 * @param random
 * @param depth
 */
export function randomFormula(random: Random, depth: number): string {
    if (depth <= 0 || random.chance(0.25)) {
        const kind: number = random.int(10)
        if (kind < 4) return random.pick(VARIABLES)
        if (kind < 8) return random.pick(NUMBERS)
        return random.pick(CONSTANTS)
    }
    const child = (): string => randomFormula(random, depth - 1)
    const wrapped = (): string => `(${child()})`
    const operand = (): string => random.chance(0.6) ? wrapped() : child()
    switch (random.int(9)) {
        case 0:
        case 1:
            return `${operand()} ${random.pick(['+', '-'])} ${operand()}`
        case 2:
            return `${operand()}${random.pick(['*', ' * ', '/', ' / '])}${operand()}`
        case 3:
            //Small exponents: (7 + 1/y)^30000 expanded in the thread of JavaScript would not end (its asynchronous
            //version stops at its time limit)
            return `${wrapped()}^${random.chance(0.8) ? random.pick(EXPONENTS) : `(${random.pick([...VARIABLES, '1/2', '3', 'pi'])})`}`
        case 4:
            return `-${wrapped()}`
        case 5:
            //Products without *: a number before a name or a parenthesis, parentheses side by side, a space
            return random.pick([
                (): string => `${random.pick(['2', '3', '0.5'])}${random.pick(VARIABLES)}`,
                (): string => `${random.pick(['2', '3'])}${wrapped()}`,
                (): string => `${wrapped()}${wrapped()}`,
                (): string => `${random.pick(VARIABLES)} ${wrapped()}`
            ])()
        case 6:
        case 7:
            return `${random.pick(SMOOTH)}(${child()})`
        default:
            return random.chance(0.5) ? `${random.pick(OTHERS)}(${child()})` : `${random.pick(['atan2', 'log', 'min', 'max', 'mod', 'hypot'])}(${child()}, ${child()})`
    }
}

const GARBAGE: string = '0123456789xyz+-*/^()!., =<>sincoexplga[]'

/**
 * A random text, mostly not a formula
 * @param random
 */
export function randomText(random: Random): string {
    let text: string = ''
    const length: number = random.int(30)
    for (let index: number = 0; index < length; index++) text += GARBAGE[random.int(GARBAGE.length)]
    return text
}

/**
 * A property that does not hold for a case
 */
export interface FuzzFailure {
    index: number
    text: string
    property: string
    message: string
}

type Value = {re: number, im: number}

function valueAt(expression: Expression, point: Record<string, number>): Value | undefined {
    try {
        const value: Value = expression.substitute(point).toComplex()
        return Number.isFinite(value.re) && Number.isFinite(value.im) ? value : undefined
    } catch (error) {
        if (error instanceof MathException) return undefined
        throw error
    }
}

function near(a: Value, b: Value, tolerance: number): boolean {
    const scale: number = globalThis.Math.max(1, globalThis.Math.hypot(a.re, a.im), globalThis.Math.hypot(b.re, b.im))
    return globalThis.Math.abs(a.re - b.re) <= tolerance * scale && globalThis.Math.abs(a.im - b.im) <= tolerance * scale
}

/**
 * The properties of one random formula: an exception of the package or a result, never another error; the printed
 * formula read back is the same; the compiled function, the expansion and the derivative agree with the exact values;
 * the asynchronous operations give the synchronous results
 * @param math
 * @param random
 * @param index
 * @param text
 */
export async function checkFormula(math: Math, random: Random, index: number, text: string): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    let expression: Expression
    try {
        expression = math.expression(text)
    } catch (error) {
        if (!(error instanceof MathException)) fail('parse', `not a MathException: ${String(error)}`)
        return failures
    }
    //Rewritten with exp, sin or cos, and written as one fraction, the expression keeps its value and its derivative
    //(below)
    let rewritten: Expression | undefined
    let fraction: [Expression, Expression] | undefined
    try {
        rewritten = expression.rewrite((['exp', 'sin', 'cos'] as const)[random.int(3)])
        fraction = [expression.numerator(), expression.denominator()]
    } catch (error) {
        if (!(error instanceof MathException)) fail('rewrite', String(error))
    }
    let readBack: Expression | undefined
    try {
        //Read back, the formula has the same value (checked below) and prints the same
        const printed: string = expression.toString()
        readBack = math.expression(printed)
        const again: string = readBack.toString()
        if (again !== printed) fail('print', `${printed} read back prints ${again}`)
        expression.toTeX()
    } catch (error) {
        fail('print', `${expression.toString()}: ${String(error)}`)
    }
    //Decimals of one digit: 0.3 + 0.4 would be 0.7000000000000001, an exact number of 16 digits
    const point: Record<string, number> = {x: (3 + random.int(17)) / 10, y: (random.int(13) - 13) / 10, z: (7 + random.int(9)) / 10}
    const exact: Value | undefined = valueAt(expression, point)
    //Real values only: on a branch cut (asinh of a purely imaginary number beyond i), asinh(-u) = -asinh(u) does not
    //hold, in SymEngine as in SymPy. Not through the functions that jump: the rounding of the rewritten form moves them
    //(floor(sinc(i)) is 1, floor(-i*cos(-pi/2 + i)) has an imaginary part of -1e-16, floored to -1). Nor the large
    //numbers: the shift of the rewritten form is lost in their doubles (sin(e^100) as cos(e^100 - pi/2))
    const unstable: boolean = /sign|floor|ceil|round|mod|arg|1e2/.test(text)
    if (exact && exact.im === 0 && rewritten && !unstable) {
        const value: Value | undefined = valueAt(rewritten, point)
        if (value && !near(value, exact, 1e-6)) fail('rewrite', `${rewritten.toString()} is ${JSON.stringify(value)} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
    }
    if (exact && fraction) {
        const top: Value | undefined = valueAt(fraction[0], point)
        const bottom: Value | undefined = valueAt(fraction[1], point)
        if (top && bottom && globalThis.Math.hypot(bottom.re, bottom.im) > 1e-9) {
            //Both scaled by the size of the denominator first: its square overflows for a large one (gamma(x + 100))
            const scale: number = globalThis.Math.max(globalThis.Math.abs(bottom.re), globalThis.Math.abs(bottom.im))
            const [a, b, c, d]: number[] = [top.re / scale, top.im / scale, bottom.re / scale, bottom.im / scale]
            const value: Value = {re: (a * c + b * d) / (c * c + d * d), im: (b * c - a * d) / (c * c + d * d)}
            if (!near(value, exact, 1e-6)) fail('fraction', `${fraction[0].toString()} / ${fraction[1].toString()} is ${JSON.stringify(value)} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
        }
    }
    if (exact && readBack) {
        const again: Value | undefined = valueAt(readBack, point)
        if (!again || !near(again, exact, 1e-9)) fail('print', `${expression.toString()} read back is ${readBack.toString()}: ${JSON.stringify(again)} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
    }
    //Not the functions with jumps: a double just below an integer has another floor
    //Nor the large numbers: sinh(1e2) has an error of 1e27 in doubles, cos(i sinh(1e2)) none of its digits
    if (exact && exact.im === 0 && !/floor|ceil|sign|trunc|round|mod|1e2/.test(text)) {
        try {
            const f = expression.compile(['x', 'y', 'z'])
            const compiled: number = f(point.x, point.y, point.z)
            //Not where the function is ill-conditioned: a change of the inputs by 1e-6 changes its value by more than
            //1e-3 (cos(1e12/y), sin((1e8 - 2z)^3): no double of the result is meaningful there)
            const moved: number = f(point.x * (1 + 1e-6), point.y * (1 + 1e-6), point.z * (1 + 1e-6))
            const conditioned: boolean = globalThis.Math.abs(moved - compiled) <= 1e-3 * globalThis.Math.max(1, globalThis.Math.abs(compiled))
            if (conditioned && Number.isFinite(compiled) && !near({re: compiled, im: 0}, exact, 1e-6)) fail('compile', `${compiled} at ${JSON.stringify(point)}, exactly ${exact.re}`)
        } catch (error) {
            if (!(error instanceof MathException)) fail('compile', String(error))
        }
    }
    try {
        const expanded: Expression = expression.expand()
        const value: Value | undefined = valueAt(expanded, point)
        //The decimals of 40 digits where they are computed: an expansion of many large terms cancels in doubles
        const decimal = (of: Expression): number | undefined => {
            try {
                return Number(of.substitute(point).toDecimal(40))
            } catch {
                return undefined
            }
        }
        const before: number | undefined = exact ? decimal(expression) : undefined
        const after: number | undefined = before === undefined ? undefined : decimal(expanded)
        if (before !== undefined && after !== undefined) {
            if (!near({re: after, im: 0}, {re: before, im: 0}, 1e-12)) fail('expand', `${expanded.toString()} is ${after} at ${JSON.stringify(point)}, before ${before}`)
        } else if (exact && value && !near(value, exact, 1e-6)) {
            fail('expand', `${expanded.toString()} is ${JSON.stringify(value)} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
        }
        const asynchronous: Expression = await expression.expandAsync()
        if (asynchronous.toString() !== expanded.toString()) fail('async', `expandAsync gives ${asynchronous.toString()}, expand ${expanded.toString()}`)
    } catch (error) {
        if (!(error instanceof MathException)) fail('expand', String(error))
    }
    //Not the large numbers either (sin(cosh(1e2 + x)) turns faster than any step)
    if (exact && exact.im === 0 && !/abs|sign|floor|ceil|min|max|round|mod|arg|1e2/.test(text)) {
        try {
            const derivative: Expression = expression.diff('x')
            const value: Value | undefined = valueAt(derivative, point)
            const h: number = 1e-5
            const after: Value | undefined = valueAt(expression, {...point, x: point.x + h})
            const before: Value | undefined = valueAt(expression, {...point, x: point.x - h})
            const half: Value | undefined = valueAt(expression, {...point, x: point.x + h / 2})
            const halfBefore: Value | undefined = valueAt(expression, {...point, x: point.x - h / 2})
            if (value && after && before && half && halfBefore && after.im === 0 && before.im === 0 && half.im === 0 && halfBefore.im === 0) {
                //Two finite differences: compared only where they agree (the function is smooth at that scale), with
                //the rounding of the values of the function itself (a large f loses its small changes)
                const estimate: number = (after.re - before.re) / (2 * h)
                const finer: number = (half.re - halfBefore.re) / h
                const rounding: number = 1e-13 * globalThis.Math.max(globalThis.Math.abs(after.re), globalThis.Math.abs(before.re)) / h
                const tolerance: number = 1e-3 * globalThis.Math.max(1, globalThis.Math.abs(value.re)) + rounding
                //Not where one step changes the function by more than 1% (tan(sinh(12x)) turns many times within it)
                const coarse: boolean = globalThis.Math.abs(value.re) * h > 1e-2 * globalThis.Math.max(1, globalThis.Math.abs(after.re), globalThis.Math.abs(before.re))
                //Nor where the doubles of the function do not see the step (cos(ln(x) - e^100))
                    || after.re === before.re
                if (!coarse && globalThis.Math.abs(estimate - finer) <= tolerance && globalThis.Math.abs(finer - value.re) > tolerance) fail('diff', `${derivative.toString()} is ${value.re} at ${JSON.stringify(point)}, its finite difference ${finer}`)
            }
            if ((await expression.diffAsync('x')).toString() !== derivative.toString()) fail('async', 'diffAsync differs from diff')
            const rewrittenDerivative: Value | undefined = rewritten ? valueAt(rewritten.diff('x'), point) : undefined
            if (value && value.im === 0 && rewrittenDerivative && !near(rewrittenDerivative, value, 1e-6)) fail('rewrite', `the derivative of ${rewritten!.toString()} is ${JSON.stringify(rewrittenDerivative)} at ${JSON.stringify(point)}, before ${value.re}`)
        } catch (error) {
            if (!(error instanceof MathException)) fail('diff', String(error))
        }
    }
    return failures
}

/**
 * A random text read: an exception of the package or a formula, never another error
 * @param math
 * @param index
 * @param text
 */
export function checkText(math: Math, index: number, text: string): FuzzFailure[] {
    try {
        math.parse(text)
        return []
    } catch (error) {
        return error instanceof MathException ? [] : [{index, text, property: 'parse', message: `not a MathException: ${String(error)}`}]
    }
}
