import {type Distribution, type DistributionName, type Expression, MathException, type MathScope, Matrix, SparseMatrix, type Unit, type UnitDimensions} from '../../exports/Math.js'
import {PREFIXES, QUANTITIES, UNITS} from '../../lib/UnitTable.js'

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

//Math, its functions and its constants off by a relative 1e-12: how much the roundings move a value
const noisyMath: Record<string, unknown> = Object.fromEntries(Object.getOwnPropertyNames(globalThis.Math).map((name: string): [string, unknown] => {
    const member: unknown = (globalThis.Math as unknown as Record<string, unknown>)[name]
    if (typeof member === 'number') return [name, member * (1 + 1e-12)]
    if (typeof member === 'function') return [name, (...args: number[]): number => (member as (...args: number[]) => number)(...args) * (1 + 1e-12)]
    return [name, member]
}))

//Whether a function keeps its value within 1e-3 when its inputs move by about 1e-6, by different factors (y/z moved
//too) and to both sides (a point on a jump of floor(a/b) has a side where the value jumps)
function steady(f: (x: number, y: number, z: number) => number, point: Record<string, number>, value: number): boolean {
    const tolerance: number = 1e-3 * globalThis.Math.max(1, globalThis.Math.abs(value))
    return [1, -1].every((side: number): boolean => {
        const moved: number = f(point.x * (1 + side * 1e-6), point.y * (1 + side * 2e-6), point.z * (1 - side * 1.5e-6))
        return globalThis.Math.abs(moved - value) <= tolerance
    })
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
export async function checkFormula(math: MathScope, random: Random, index: number, text: string): Promise<FuzzFailure[]> {
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
    //Whether the roundings decide the value: the code of JavaScript run again with every result of Math off by 1e-12
    //moves it by more than 1e-6 (cos(e^144): the doubles of e^144 have no digit of its cosine)
    let roundingBound: boolean = false
    try {
        const code = new Function('Math', 'x', 'y', 'z', `return ${expression.toJavaScript()}`) as (math: unknown, x: number, y: number, z: number) => number
        const value: number = code(globalThis.Math, point.x, point.y, point.z)
        roundingBound = globalThis.Math.abs(code(noisyMath, point.x, point.y, point.z) - value) > 1e-6 * globalThis.Math.max(1, globalThis.Math.abs(value))
    } catch (error) {
        if (!(error instanceof MathException)) throw error
    }
    //Real values only: on a branch cut (asinh of a purely imaginary number beyond i), asinh(-u) = -asinh(u) does not
    //hold, in SymEngine as in SymPy. Not through the functions that jump: the rounding of the rewritten form moves them
    //(floor(sinc(i)) is 1, floor(-i*cos(-pi/2 + i)) has an imaginary part of -1e-16, floored to -1). Nor the large
    //numbers: the shift of the rewritten form is lost in their doubles (sin(e^100) as cos(e^100 - pi/2))
    const unstable: boolean = /sign|floor|ceil|round|mod|arg|1e2/.test(text) || roundingBound
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
            const conditioned: boolean = steady(f, point, compiled)
            //Nor where the roundings decide the value of the doubles (sin(cosh(e^4)): no input to move)
            if (conditioned && !roundingBound && Number.isFinite(compiled) && !near({re: compiled, im: 0}, exact, 1e-6)) fail('compile', `${compiled} at ${JSON.stringify(point)}, exactly ${exact.re}`)
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
    //The code of JavaScript gives the value of the compiled function, where the function is well conditioned (not
    //at a jump, nor where a change of 1e-6 of the inputs moves the value by more than 1e-3); NaN only where the
    //compiled function computes a part in the complex numbers, never a number where it has none
    if (!/1e2/.test(text)) {
        try {
            const code: string = expression.toJavaScript()
            const f = new Function('Math', 'x', 'y', 'z', `return ${code}`) as (math: unknown, x: number, y: number, z: number) => number
            const compiled = expression.compile(['x', 'y', 'z'])
            const value: number = f(globalThis.Math, point.x, point.y, point.z)
            const expected: number = compiled(point.x, point.y, point.z)
            //And not where the roundings decide the value (tan(e^(pi^4)): no input to move)
            const conditioned: boolean = steady(compiled, point, expected) && !roundingBound
            if (Number.isNaN(expected) && Number.isFinite(value)) fail('javascript', `${code} is ${value} at ${JSON.stringify(point)}, where the formula has no real value`)
            if (conditioned && Number.isFinite(value) && Number.isFinite(expected) && !near({re: value, im: 0}, {re: expected, im: 0}, 1e-9)) {
                fail('javascript', `${code} is ${value} at ${JSON.stringify(point)}, compiled ${expected}`)
            }
        } catch (error) {
            if (!(error instanceof MathException)) fail('javascript', String(error))
        }
    }
    //The common subexpressions, substituted back, give the expression; their values print and read back
    try {
        const {replacements, expressions: [reduced]} = math.cse([expression])
        let back: Expression = reduced
        for (let at: number = replacements.length - 1; at >= 0; at--) back = back.substitute({[replacements[at].name]: replacements[at].value})
        for (const {value} of replacements) {
            if (math.expression(value.toString()).toString() !== value.toString()) fail('cse', `${value.toString()} does not read back`)
        }
        const value: Value | undefined = exact ? valueAt(back, point) : undefined
        if (exact && value && !near(value, exact, 1e-9)) fail('cse', `${back.toString()} is ${JSON.stringify(value)} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
    } catch (error) {
        if (!(error instanceof MathException)) fail('cse', String(error))
    }
    //The rectangular and the polar forms rebuild the value (not through the jumps, moved by the roundings)
    if (exact && !unstable) {
        try {
            const real = (part: Value | undefined): boolean => part !== undefined && globalThis.Math.abs(part.im) <= 1e-9 * globalThis.Math.max(1, globalThis.Math.abs(part.re))
            const {real: re, imaginary: im} = expression.toRectangular()
            const a: Value | undefined = valueAt(re, point), b: Value | undefined = valueAt(im, point)
            if (a && b && (!real(a) || !real(b) || !near({re: a.re, im: b.re}, exact, 1e-6))) {
                fail('rectangular', `${re.toString()} | ${im.toString()} is ${JSON.stringify([a, b])} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
            }
            const {modulus, argument} = expression.toPolar()
            const r: Value | undefined = valueAt(modulus, point), angle: Value | undefined = valueAt(argument, point)
            if (r && angle) {
                const rebuilt: Value = {re: r.re * globalThis.Math.cos(angle.re), im: r.re * globalThis.Math.sin(angle.re)}
                if (!real(r) || !real(angle) || !near(rebuilt, exact, 1e-6)) fail('polar', `${modulus.toString()} | ${argument.toString()} is ${JSON.stringify([r, angle])} at ${JSON.stringify(point)}, before ${JSON.stringify(exact)}`)
            }
        } catch (error) {
            if (!(error instanceof MathException)) fail('rectangular', String(error))
        }
    }
    //The complex decimals agree with the decimals of the rectangular parts, which the real evaluator computes: two
    //paths to the same correctly rounded digits
    if (exact && !unstable) {
        try {
            const {real: re, imaginary: im} = expression.toRectangular()
            const value: {re: string, im: string} = expression.substitute(point).toComplexDecimal(20)
            const parts: string[] = [re.substitute(point).toDecimal(20), im.substitute(point).toDecimal(20)]
            if (value.re !== parts[0] || value.im !== parts[1]) fail('decimals', `${JSON.stringify(value)} at ${JSON.stringify(point)}, its parts ${re.toString()} | ${im.toString()} ${JSON.stringify(parts)}`)
        } catch (error) {
            if (!(error instanceof MathException)) fail('decimals', String(error))
        }
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
                //The two estimates agree with each other in their own size too (two noises of a function turning 10^11
                //times by unit agree in absolute value: sinc(sinh((x + 9/4)^pi)))
                const agree: boolean = globalThis.Math.abs(estimate - finer) <= tolerance
                    && globalThis.Math.abs(estimate - finer) <= 1e-2 * globalThis.Math.max(globalThis.Math.abs(estimate), globalThis.Math.abs(finer)) + rounding
                if (!coarse && agree && globalThis.Math.abs(finer - value.re) > tolerance) fail('diff', `${derivative.toString()} is ${value.re} at ${JSON.stringify(point)}, its finite difference ${finer}`)
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

//A random matrix of rows and columns: of elements from -10 to 10, now and then of a rank below its size (a product of
//thinner matrices) or with a large diagonal
function randomMatrix(math: MathScope, random: Random, rows: number, columns: number): Matrix {
    if (rows > 1 && columns > 1 && random.chance(0.2)) {
        const inner: number = 1 + random.int(globalThis.Math.min(rows, columns) - 1)
        return randomMatrix(math, random, rows, inner).mul(randomMatrix(math, random, inner, columns))
    }
    const diagonal: number = random.chance(0.3) ? 20 * (rows + columns) : 0
    return math.linalg.fromFunction(rows, columns, (i: number, j: number): number => globalThis.Math.round((random.next() * 20 - 10) * 100) / 100 + (i === j ? diagonal : 0))
}

function frobenius(matrix: Matrix): number {
    return matrix.data.reduce((sum: number, value: number): number => sum + value * value, 0) ** 0.5
}

/**
 * The properties of random matrices: the products associate and transpose; a solution of a system, an inverse, a
 * least-squares solution have small residuals (backward errors); determinants multiply; the singular values give the
 * Frobenius norm and the rank; the asynchronous operations give the synchronous results
 * @param math
 * @param random
 * @param index
 */
export async function checkMatrices(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    const size = (): number => random.chance(0.05) ? 0 : 1 + random.int(random.chance(0.1) ? 40 : 7)
    const n: number = size(), m: number = size(), k: number = size()
    const a: Matrix = randomMatrix(math, random, n, m), b: Matrix = randomMatrix(math, random, m, k), c: Matrix = randomMatrix(math, random, k, n)
    const square: Matrix = randomMatrix(math, random, n, n)
    const text: string = `${square.toString()} | ${a.toString()} | ${b.toString()}`.slice(0, 400)
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const left: Matrix = a.mul(b).mul(c), right: Matrix = a.mul(b.mul(c))
        const scale: number = frobenius(a) * frobenius(b) * frobenius(c)
        if (frobenius(left.sub(right)) > 1e-12 * scale + 1e-300) fail('multiply', `(ab)c and a(bc) differ by ${frobenius(left.sub(right))}`)
        if (!a.mul(b).transpose().equals(b.transpose().mul(a.transpose()), 1e-12 * frobenius(a) * frobenius(b))) fail('multiply', '(ab)^T is not b^T a^T')
        //A system and an inverse of a matrix not singular: backward errors of the order of the roundings
        const values: Float64Array = math.linalg.singularValues(square)
        const condition: number = math.linalg.condition(square)
        const vector: Float64Array = Float64Array.from({length: n}, (): number => random.next() * 20 - 10)
        if (n > 0 && values[n - 1] > 0 && condition < 1e10) {
            const x: Float64Array = math.linalg.solve(square, vector)
            const residual: number = math.linalg.norm(square.mul(x).map((value: number, i: number): number => value - vector[i]))
            const bound: number = 1e-13 * n * (frobenius(square) * math.linalg.norm(x) + math.linalg.norm(vector))
            if (residual > bound) fail('solve', `residual ${residual} above ${bound}`)
            const inverse: Matrix = math.linalg.inverse(square)
            const error: number = frobenius(square.mul(inverse).sub(math.linalg.identity(n)))
            if (error > 1e-13 * n * condition) fail('inverse', `a a^-1 - I is ${error}, condition ${condition}`)
            const product: number = math.linalg.determinant(square.mul(square)), squared: number = math.linalg.determinant(square) ** 2
            if (globalThis.Math.abs(product - squared) > 1e-11 * condition * globalThis.Math.abs(squared)) fail('determinant', `det(a^2) ${product}, det(a)^2 ${squared}`)
            if ((await math.linalg.solveAsync(square, vector)).some((value: number, i: number): boolean => value !== x[i])) fail('async', 'solveAsync differs from solve')
        }
        //Least squares: the residual is orthogonal to the columns (the normal equations)
        const rhs: Float64Array = Float64Array.from({length: n}, (): number => random.next() * 20 - 10)
        if (n > 0 && m > 0) {
            const x: Float64Array = math.linalg.leastSquares(a, rhs)
            const residual: Matrix = new Matrix(n, 1, a.mul(x)).sub(new Matrix(n, 1, rhs))
            const normal: number = frobenius(a.transpose().mul(residual))
            const bound: number = 1e-11 * frobenius(a) * (frobenius(a) * math.linalg.norm(x) + math.linalg.norm(rhs))
            if (math.linalg.condition(a) < 1e8 && normal > bound) fail('leastSquares', `a^T (a x - b) is ${normal}, above ${bound}`)
        }
        //The singular values: their squares sum to the square of the Frobenius norm; the rank of a and of its transpose
        const singular: Float64Array = math.linalg.singularValues(a)
        const squares: number = singular.reduce((sum: number, value: number): number => sum + value * value, 0)
        if (globalThis.Math.abs(squares - frobenius(a) ** 2) > 1e-12 * frobenius(a) ** 2 + 1e-300) fail('singularValues', `Σσ² ${squares}, ‖a‖² ${frobenius(a) ** 2}`)
        if (singular.some((value: number, i: number): boolean => i > 0 && value > singular[i - 1])) fail('singularValues', 'not descending')
        if (math.linalg.rank(a) !== math.linalg.rank(a.transpose())) fail('rank', `rank ${math.linalg.rank(a)}, of the transpose ${math.linalg.rank(a.transpose())}`)
        //The decompositions rebuild their matrices, of the order of the roundings
        const near = (x: Matrix, y: Matrix, scale: number): boolean => frobenius(x.sub(y)) <= 1e-12 * (1 + scale) * (1 + x.rows + x.columns)
        const {lower, upper, permutation} = math.linalg.lu(square)
        if (!near(lower.mul(upper), math.linalg.fromRows(permutation.map((row: number): Float64Array => square.row(row))).reshape(n, n), frobenius(square))) fail('lu', 'P A is not L U')
        const {q, r} = math.linalg.qr(a)
        if (!near(q.mul(r), a, frobenius(a)) || !near(q.transpose().mul(q), math.linalg.identity(q.columns), 1)) fail('qr', 'A is not Q R, or Q not orthonormal')
        const {u, singularValues, v} = math.linalg.svd(a)
        if (!near(u.mul(math.linalg.diagonal(singularValues)).mul(v.transpose()), a, frobenius(a))) fail('svd', 'A is not U S Vᵀ')
        const symmetric: Matrix = square.add(square.transpose())
        const eigen = math.linalg.symmetricEigen(symmetric)
        if (!near(eigen.vectors.mul(math.linalg.diagonal(eigen.values)).mul(eigen.vectors.transpose()), symmetric, frobenius(symmetric))) fail('symmetricEigen', 'A is not V Λ Vᵀ')
        const schur = math.linalg.schur(square)
        if (!near(schur.u.mul(schur.t).mul(schur.u.transpose()), square, frobenius(square))) fail('schur', 'A is not U T Uᵀ')
        const general = math.linalg.eigen(square)
        if (n > 0 && condition < 1e6) {
            //A V = V Λ in complex arithmetic, of the conditioning of the eigenvectors
            const re: Matrix = general.vectors.re, im: Matrix = general.vectors.im
            const left: Matrix = square.mul(re), right: Matrix = square.mul(im)
            const lr: Matrix = re.map((x: number, i: number, j: number): number => general.values.re[j] * x - general.values.im[j] * im.get(i, j))
            const li: Matrix = im.map((x: number, i: number, j: number): number => general.values.re[j] * x + general.values.im[j] * re.get(i, j))
            const residual: number = frobenius(left.sub(lr)) + frobenius(right.sub(li))
            if (residual > 1e-9 * (1 + frobenius(square)) * n) fail('eigen', `A v - λ v is ${residual}`)
        }
        //Positive definite in doubles too: AᵀA plus a multiple of the identity of its size
        const positive: Matrix = a.transpose().mul(a).add(math.linalg.identity(m).mul(1 + frobenius(a) ** 2))
        const cholesky: Matrix = math.linalg.cholesky(positive)
        if (!near(cholesky.mul(cholesky.transpose()), positive, frobenius(positive))) fail('cholesky', 'A is not L Lᵀ')
        //The pseudo-inverse: A A⁺ A = A
        const pseudo: Matrix = math.linalg.pseudoInverse(a)
        if (math.linalg.condition(a) < 1e8 && !near(a.mul(pseudo).mul(a), a, frobenius(a) * frobenius(a) * frobenius(pseudo))) fail('pseudoInverse', 'A A⁺ A is not A')
        //The exponential of a matrix of a norm up to 3: exp(S) exp(-S) = I, det(exp(S)) = e^tr(S)
        const scaled: Matrix = square.mul(3 / (1 + frobenius(square)))
        const exponential: Matrix = math.linalg.exponential(scaled), inverse: Matrix = math.linalg.exponential(scaled.neg())
        const size: number = frobenius(exponential) * frobenius(inverse)
        if (!near(exponential.mul(inverse), math.linalg.identity(n), size)) fail('exponential', 'exp(S) exp(-S) is not I')
        const determinant: number = math.linalg.determinant(exponential), trace: number = globalThis.Math.exp(scaled.trace())
        if (globalThis.Math.abs(determinant - trace) > 1e-12 * (1 + n) * size * trace) fail('exponential', `det(exp(S)) is ${determinant}, e^tr(S) ${trace}`)
        if (!(await math.linalg.exponentialAsync(scaled)).equals(exponential)) fail('async', 'exponentialAsync differs from exponential')
        //The principal square roots of a matrix of eigenvalues of positive real parts and of a positive definite one
        //(symmetric): X X = M
        const shifted: Matrix = square.add(math.linalg.identity(n).mul(1 + 2 * frobenius(square)))
        const root: Matrix = math.linalg.squareRoot(shifted)
        if (!near(root.mul(root), shifted, frobenius(root) ** 2 + frobenius(shifted))) fail('squareRoot', 'X X is not M')
        const symmetricRoot: Matrix = math.linalg.squareRoot(positive)
        if (!near(symmetricRoot.mul(symmetricRoot), positive, frobenius(positive)) || !near(symmetricRoot, symmetricRoot.transpose(), frobenius(symmetricRoot))) fail('squareRoot', 'the root of a positive definite matrix')
        //The Sylvester equation of A and B whose eigenvalues cannot add up to 0, the Lyapunov equation of a stable A
        const other: Matrix = randomMatrix(math, random, k, k), side: Matrix = randomMatrix(math, random, n, k), constant: Matrix = randomMatrix(math, random, n, n)
        const shift: number = 1 + frobenius(square) + frobenius(other)
        const first: Matrix = square.add(math.linalg.identity(n).mul(shift)), second: Matrix = other.add(math.linalg.identity(k).mul(shift))
        const x: Matrix = math.linalg.sylvester(first, second, side)
        if (!near(first.mul(x).add(x.mul(second)), side, (frobenius(first) + frobenius(second)) * frobenius(x) + frobenius(side))) fail('sylvester', 'A X + X B is not C')
        const stable: Matrix = square.sub(math.linalg.identity(n).mul(1 + 2 * frobenius(square)))
        const p: Matrix = math.linalg.lyapunov(stable, constant)
        if (!near(stable.mul(p).add(p.mul(stable.transpose())).neg(), constant, 2 * frobenius(stable) * frobenius(p) + frobenius(constant))) fail('lyapunov', 'A P + P Aᵀ + Q is not 0')
    } catch (error) {
        if (!(error instanceof MathException)) fail('matrices', String(error))
    }
    return failures
}

/**
 * A random text read: an exception of the package or a formula, never another error
 * @param math
 * @param index
 * @param text
 */
export function checkText(math: MathScope, index: number, text: string): FuzzFailure[] {
    try {
        math.parse(text)
        return []
    } catch (error) {
        return error instanceof MathException ? [] : [{index, text, property: 'parse', message: `not a MathException: ${String(error)}`}]
    }
}

//A random sparse matrix: entries of -10 to 10 at a density of 0.05 to 0.3, given in any order, now and then twice at
//the same place; dominant, of a large diagonal
function randomSparse(math: MathScope, random: Random, rows: number, columns: number, dominant: boolean = false): SparseMatrix {
    const density: number = 0.05 + 0.25 * random.next()
    const entries: [number, number, number][] = []
    for (let i: number = 0; i < rows; i++) {
        for (let j: number = 0; j < columns; j++) {
            if (random.next() < density) entries.push([i, j, globalThis.Math.round((random.next() * 20 - 10) * 100) / 100])
        }
    }
    if (entries.length && random.chance(0.3)) entries.push([entries[0][0], entries[0][1], 1])
    if (dominant) for (let i: number = 0; i < globalThis.Math.min(rows, columns); i++) entries.push([i, i, 20 * (columns + 2)])
    for (let i: number = entries.length - 1; i > 0; i--) {
        const j: number = random.int(i + 1)
        const swapped: [number, number, number] = entries[i]
        entries[i] = entries[j]
        entries[j] = swapped
    }
    return math.linalg.sparse(rows, columns, entries)
}

/**
 * The checks of the sparse matrices: their operations against those of their dense matrices, the solutions of their
 * systems (the sparse LU decomposition, the conjugate gradient, BiCGSTAB) by their residuals
 * @param math
 * @param random
 * @param index
 */
export async function checkSparse(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    const size = (): number => random.chance(0.05) ? 0 : 1 + random.int(random.chance(0.1) ? 60 : 8)
    const n: number = size(), m: number = size(), k: number = size()
    const a: SparseMatrix = randomSparse(math, random, n, m), b: SparseMatrix = randomSparse(math, random, m, k), other: SparseMatrix = randomSparse(math, random, n, m)
    const dense: Matrix = a.toDense()
    const text: string = JSON.stringify(a.toEntries()).slice(0, 400)
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const near = (x: Matrix, y: Matrix, scale: number): boolean => frobenius(x.sub(y)) <= 1e-12 * (1 + scale) * (1 + x.rows + x.columns)
    try {
        //The operations in JavaScript: the same elements as the dense ones, exactly
        if (!a.transpose().toDense().equals(dense.transpose())) fail('sparse', 'the transpose')
        if (!a.add(other).toDense().equals(dense.add(other.toDense())) || !a.sub(other).toDense().equals(dense.sub(other.toDense()))) fail('sparse', 'a sum or a difference')
        if (!a.neg().toDense().equals(dense.neg()) || !a.mul(-2.5).toDense().equals(dense.mul(-2.5))) fail('sparse', 'a product by a number')
        for (let i: number = 0; i < n; i++) {
            for (let j: number = 0; j < m; j++) if (a.get(i, j) !== dense.get(i, j)) fail('sparse', `the element ${i}, ${j}`)
        }
        if (JSON.stringify(math.linalg.sparse(n, m, a.toEntries()).toEntries()) !== JSON.stringify(a.toEntries())) fail('sparse', 'its entries')
        if (!math.linalg.sparse(dense).toDense().equals(dense)) fail('sparse', 'the sparse matrix of a dense one')
        //The products: by a vector and a dense matrix in JavaScript, by a sparse matrix by Eigen
        const vector: Float64Array = Float64Array.from({length: m}, (): number => random.next() * 20 - 10)
        if (!near(new Matrix(n, 1, a.mul(vector)), new Matrix(n, 1, dense.mul(vector)), frobenius(dense) * math.linalg.norm(vector))) fail('sparse', 'a product by a vector')
        const right: Matrix = b.toDense()
        if (!near(a.mul(right), dense.mul(right), frobenius(dense) * frobenius(right))) fail('sparse', 'a product by a dense matrix')
        const product: SparseMatrix = a.mul(b)
        if (!(product instanceof SparseMatrix) || !near(product.toDense(), dense.mul(right), frobenius(dense) * frobenius(right))) fail('sparse', 'a product by a sparse matrix')
        //A system of a dominant matrix: the sparse LU decomposition as the dense one; the conjugate gradient on its
        //symmetric part (positive definite), BiCGSTAB on it
        const square: SparseMatrix = randomSparse(math, random, n, n, true)
        const side: Float64Array = Float64Array.from({length: n}, (): number => random.next() * 20 - 10)
        const residual = (matrix: SparseMatrix, x: Float64Array): number => math.linalg.norm(matrix.mul(x).map((value: number, i: number): number => value - side[i]))
        const solution: Float64Array = math.linalg.solve(square, side)
        const bound: number = 1e-13 * (1 + n) * (frobenius(square.toDense()) * math.linalg.norm(solution) + math.linalg.norm(side))
        if (residual(square, solution) > bound) fail('sparse', `the residual of solve() is ${residual(square, solution)}, above ${bound}`)
        if (!near(new Matrix(n, 1, solution), new Matrix(n, 1, math.linalg.solve(square.toDense(), side)), math.linalg.norm(solution))) fail('sparse', 'solve() differs from the dense one')
        const symmetric: SparseMatrix = square.add(square.transpose())
        const gradient = math.linalg.conjugateGradient(symmetric, side)
        if (!gradient.converged || residual(symmetric, gradient.solution) > 1e-9 * (1 + math.linalg.norm(side))) fail('sparse', `the conjugate gradient: converged ${gradient.converged}, residual ${residual(symmetric, gradient.solution)}`)
        const stabilized = math.linalg.biconjugateGradientStabilized(square, side)
        if (!stabilized.converged || residual(square, stabilized.solution) > 1e-9 * (1 + math.linalg.norm(side))) fail('sparse', `BiCGSTAB: converged ${stabilized.converged}, residual ${residual(square, stabilized.solution)}`)
        if ((await math.linalg.solveAsync(square, side)).some((value: number, i: number): boolean => value !== solution[i])) fail('async', 'solveAsync of a sparse matrix differs from solve')
        if ((await math.linalg.conjugateGradientAsync(symmetric, side)).solution.some((value: number, i: number): boolean => value !== gradient.solution[i])) fail('async', 'conjugateGradientAsync differs from conjugateGradient')
    } catch (error) {
        if (!(error instanceof MathException)) fail('sparse', String(error))
    }
    return failures
}

//Random values: of -100 to 100, now and then integers of few values (modes, ties), under a large offset or of very
//different sizes
function randomValues(random: Random, size: number): Float64Array {
    const kind: number = random.int(4)
    const offset: number = kind === 2 ? 10 ** (6 + random.int(7)) : 0
    return Float64Array.from({length: size}, (): number => {
        if (kind === 1) return random.int(5)
        if (kind === 3) return (random.next() * 2 - 1) * 10 ** (random.int(30) - 15)
        return offset + globalThis.Math.round((random.next() * 200 - 100) * 1e6) / 1e6
    })
}

/**
 * The checks of the statistics: the sums against the sums of the values shuffled, the statistics of the order against
 * the values sorted in JavaScript, the quantiles at 0, 1/2 and 1, the variances against their shifts and their
 * normalizations, the z-scores, the covariances and the divergences of a vector with itself
 * @param math
 * @param random
 * @param index
 */
export async function checkStatistics(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    const n: number = 1 + random.int(random.chance(0.1) ? 2000 : 40)
    const x: Float64Array = randomValues(random, n)
    const text: string = JSON.stringify(Array.from(x.subarray(0, 12)))
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const u: number = Number.EPSILON / 2
    try {
        const stats = math.stats
        //The sums, of the values in any order: within the bound of Neumaier's sum
        const absolute: number = x.reduce((total: number, value: number): number => total + globalThis.Math.abs(value), 0)
        const shuffled: Float64Array = x.slice()
        for (let i: number = n - 1; i > 0; i--) {
            const j: number = random.int(i + 1)
            const swapped: number = shuffled[i]
            shuffled[i] = shuffled[j]
            shuffled[j] = swapped
        }
        const sum: number = stats.sum(x)
        if (globalThis.Math.abs(sum - stats.sum(shuffled)) > 4 * u * globalThis.Math.abs(sum) + 4 * n * n * u * u * absolute) fail('sum', `${sum} and ${stats.sum(shuffled)} shuffled`)
        const sums: Float64Array = stats.cumulativeSum(x)
        const prefix: number = random.int(n)
        if (sums[n - 1] !== sum || sums[prefix] !== stats.sum(x.subarray(0, prefix + 1))) fail('sum', `the cumulative sums ${sums[prefix]} and ${sums[n - 1]} are not the sums of their values`)
        const differences: Float64Array = stats.differences(x)
        if (differences.length !== n - 1 || differences.some((value: number, i: number): boolean => value !== x[i + 1] - x[i])) fail('differences', 'not x[i + 1] - x[i]')
        //The statistics of the order, against the values sorted
        const sorted: Float64Array = x.slice().sort()
        const min: number = stats.min(x), max: number = stats.max(x), median: number = stats.median(x)
        if (min !== sorted[0] || max !== sorted[n - 1]) fail('order', `min ${min}, max ${max}`)
        const middle: number = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        if (median !== middle) fail('median', `${median}, sorted ${middle}`)
        //The quantile of 1/2 is the median but for the rounding of its interpolation (b - (b - a) / 2, (a + b) / 2 for
        //the median, as NumPy's)
        const quantiles: Float64Array = stats.quantile(x, [0, 0.5, 1])
        const halfway: number = 4 * u * globalThis.Math.max(globalThis.Math.abs(min), globalThis.Math.abs(max))
        if (quantiles[0] !== min || globalThis.Math.abs(quantiles[1] - median) > halfway || quantiles[2] !== max) fail('quantile', `${Array.from(quantiles).join(', ')}, median ${median}`)
        const probabilities: number[] = Array.from({length: 20}, (): number => random.next()).sort((a: number, b: number): number => a - b)
        const ordered: Float64Array = stats.quantile(x, probabilities)
        if (ordered.some((value: number, i: number): boolean => i > 0 && value < ordered[i - 1] || value < min || value > max)) fail('quantile', 'not increasing with the probability, or outside the values')
        const counts: Map<number, number> = new Map()
        for (const value of x) counts.set(value, (counts.get(value) ?? 0) + 1)
        const most: number = globalThis.Math.max(...counts.values())
        const modes: number[] = [...counts.entries()].filter(([, count]: [number, number]): boolean => count === most).map(([value]: [number, number]): number => value).sort((a: number, b: number): number => a - b)
        if (JSON.stringify(Array.from(stats.mode(x))) !== JSON.stringify(modes)) fail('mode', `${Array.from(stats.mode(x)).slice(0, 5).join(', ')}, counted ${modes.slice(0, 5).join(', ')}`)
        const deviations: Float64Array = x.map((value: number): number => globalThis.Math.abs(value - median))
        if (stats.medianAbsoluteDeviation(x) !== stats.median(deviations)) fail('mad', 'not the median of the deviations from the median')
        //The variances: of their normalizations, under a shift, the covariance and the correlation of a vector with
        //itself, the z-scores
        const mean: number = stats.mean(x), variance: number = stats.variance(x)
        if (!(mean >= min && mean <= max)) fail('mean', `${mean} outside ${min}, ${max}`)
        const largest: number = globalThis.Math.max(globalThis.Math.abs(min), globalThis.Math.abs(max))
        const rounding: number = 8 * n * u * largest * largest
        if (variance < -rounding) fail('variance', `${variance} below 0`)
        if (n > 1 && globalThis.Math.abs(stats.variance(x, {normalization: 'unbiased'}) * (n - 1) - variance * n) > 4 * u * variance * n + rounding) fail('variance', 'the normalizations disagree')
        if (stats.standardDeviation(x) !== globalThis.Math.sqrt(variance)) fail('std', 'not the square root of the variance')
        const shift: number = 1000 * (largest + 1)
        const shifted: number = stats.variance(x.map((value: number): number => value + shift))
        if (globalThis.Math.abs(shifted - variance) > 8 * n * u * (largest + shift) ** 2 + rounding) fail('variance', `${variance}, shifted ${shifted}`)
        if (stats.covariance(x, x) !== variance) fail('covariance', 'cov(x, x) is not var(x)')
        if (variance > rounding * 1e3) {
            const correlation: number = stats.correlation(x, x)
            if (globalThis.Math.abs(correlation - 1) > 4 * u) fail('correlation', `corr(x, x) is ${correlation}`)
            //Of mean 0 and of deviation 1, but for the roundings of the values, magnified by their mean over their
            //deviation
            const scores: Float64Array = stats.zScores(x)
            const magnified: number = 16 * n * u * (1 + largest / globalThis.Math.sqrt(variance))
            if (globalThis.Math.abs(stats.mean(scores)) > magnified || globalThis.Math.abs(stats.standardDeviation(scores) - 1) > magnified) fail('zscore', `of mean ${stats.mean(scores)}, of deviation ${stats.standardDeviation(scores)}`)
        }
        //The divergence of a distribution from itself is 0, from another not negative
        const p: Float64Array = x.map(globalThis.Math.abs), q: Float64Array = randomValues(random, n).map(globalThis.Math.abs)
        if (stats.sum(p) > 0 && stats.sum(q) > 0) {
            if (globalThis.Math.abs(stats.klDivergence(p, p)) > 4 * n * u) fail('kldivergence', `of p from p ${stats.klDivergence(p, p)}`)
            if (stats.klDivergence(p, q) < -4 * n * u) fail('kldivergence', `${stats.klDivergence(p, q)} below 0`)
        }
    } catch (error) {
        if (!(error instanceof MathException)) fail('statistics', String(error))
    }
    return failures
}

//A distribution of random parameters, in their domains
function randomDistribution(math: MathScope, random: Random): Distribution {
    const between = (low: number, high: number): number => low + (high - low) * random.next()
    const integer = (low: number, high: number): number => low + random.int(high - low + 1)
    const names: DistributionName[] = ['normal', 'lognormal', 'uniform', 'exponential', 'gamma', 'beta', 'chiSquared', 'studentT', 'fisherF', 'cauchy', 'laplace', 'logistic', 'weibull', 'pareto', 'rayleigh', 'triangular', 'gumbel', 'inverseGamma', 'bernoulli', 'binomial', 'poisson', 'geometric', 'negativeBinomial', 'hypergeometric']
    const name: DistributionName = names[random.int(names.length)]
    const lower: number = between(-5, 0), upper: number = lower + between(0.1, 10), total: number = integer(1, 200), successes: number = integer(0, total)
    const parameters: Record<DistributionName, Record<string, number>> = {
        normal: {mean: between(-10, 10), standardDeviation: between(0.1, 5)},
        lognormal: {logMean: between(-1, 1), logStandardDeviation: between(0.1, 1)},
        uniform: {lower, upper},
        exponential: {rate: between(0.1, 5)},
        gamma: {shape: between(0.2, 10), scale: between(0.1, 5)},
        beta: {alpha: between(0.2, 10), beta: between(0.2, 10)},
        chiSquared: {degrees: between(0.5, 30)},
        studentT: {degrees: between(0.5, 30)},
        fisherF: {numeratorDegrees: between(0.5, 30), denominatorDegrees: between(0.5, 30)},
        cauchy: {location: between(-5, 5), scale: between(0.1, 5)},
        laplace: {location: between(-5, 5), scale: between(0.1, 5)},
        logistic: {location: between(-5, 5), scale: between(0.1, 5)},
        weibull: {shape: between(0.3, 5), scale: between(0.1, 5)},
        pareto: {scale: between(0.1, 5), shape: between(0.5, 10)},
        rayleigh: {scale: between(0.1, 5)},
        triangular: {lower, mode: lower + (upper - lower) * random.next(), upper},
        gumbel: {location: between(-5, 5), scale: between(0.1, 5)},
        inverseGamma: {shape: between(0.5, 10), scale: between(0.1, 5)},
        bernoulli: {probability: random.next()},
        binomial: {trials: integer(0, 200), probability: random.next()},
        poisson: {mean: between(0.1, 100)},
        geometric: {probability: between(0.01, 1)},
        negativeBinomial: {successes: between(0.5, 20), probability: between(0.05, 1)},
        hypergeometric: {total, successes, draws: integer(0, total)}
    }
    return math.stats.distribution(name, parameters[name])
}

/**
 * The checks of the distributions of random parameters: their cdf nondecreasing and complementary to their survival
 * function, their quantiles inverting their cdf (the smallest integer of a cdf at least p for a discrete one), their
 * densities not negative, the means of their samples near theirs, the samples of a seed the same each time
 * @param math
 * @param random
 * @param index
 */
export async function checkDistributions(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const distribution: Distribution = randomDistribution(math, random)
        text = `${distribution.name}(${JSON.stringify(distribution.parameters)})`
        const discrete: boolean = distribution.kind === 'discrete'
        const probabilities: number[] = Array.from({length: 12}, (): number => random.next()).sort((a: number, b: number): number => a - b)
        const points: Float64Array = Float64Array.from(distribution.quantile(probabilities)).sort()
        const cdf: Float64Array = distribution.cdf(points), survival: Float64Array = distribution.survival(points), pdf: Float64Array = distribution.pdf(points)
        cdf.forEach((value: number, i: number): void => {
            if (!(value >= 0 && value <= 1) || (i > 0 && value < cdf[i - 1])) fail('cdf', `${value} at ${points[i]}, not of [0, 1] or decreasing`)
            if (globalThis.Math.abs(value + survival[i] - 1) > 1e-12) fail('survival', `cdf ${value} + survival ${survival[i]} at ${points[i]} is not 1`)
            if (!(pdf[i] >= 0)) fail('pdf', `${pdf[i]} at ${points[i]}`)
        })
        if (discrete) {
            //The quantile of p: cdf(q - 1) < p <= cdf(q)
            const quantiles: Float64Array = distribution.quantile(probabilities)
            const at: Float64Array = distribution.cdf(quantiles), below: Float64Array = distribution.cdf(quantiles.map((q: number): number => q - 1))
            probabilities.forEach((p: number, i: number): void => {
                if (!(at[i] >= p) || (quantiles[i] > distribution.support[0] && !(below[i] < p))) fail('quantile', `${quantiles[i]} of ${p}: cdf ${at[i]}, below ${below[i]}`)
            })
        } else {
            //quantile(cdf(x)) = x where the cdf is not flat in the doubles
            const back: Float64Array = distribution.quantile(cdf)
            points.forEach((x: number, i: number): void => {
                const flat: boolean = cdf[i] < 1e-8 || cdf[i] > 1 - 1e-8 || pdf[i] * (1 + globalThis.Math.abs(x)) < 1e-6
                if (!flat && globalThis.Math.abs(back[i] - x) > 1e-7 * (1 + globalThis.Math.abs(x))) fail('quantile', `quantile(cdf(${x})) is ${back[i]}`)
            })
        }
        //Samples: the same of a seed; their mean within 6 standard errors of the mean, where the fourth moment is
        //finite (with heavier tails one large sample moves the mean further: Pareto of a shape below 4)
        const seed: number = random.int(1000000)
        const samples: Float64Array = distribution.sample(4000, math.stats.random(seed))
        if (distribution.sample(4000, math.stats.random(seed)).some((value: number, i: number): boolean => !Object.is(value, samples[i]))) fail('sample', 'two samples of a seed differ')
        if (samples.some((value: number): boolean => value < distribution.support[0] || value > distribution.support[1] || (discrete && value !== globalThis.Math.floor(value)))) fail('sample', 'a sample outside the support')
        if (Number.isFinite(distribution.variance) && distribution.variance > 0 && Number.isFinite(distribution.excessKurtosis)) {
            const error: number = globalThis.Math.abs(math.stats.mean(samples) - distribution.mean) / globalThis.Math.sqrt(distribution.variance / samples.length)
            if (error > 6) fail('sample', `the mean of the samples ${math.stats.mean(samples)} is ${error} standard errors from ${distribution.mean}`)
        }
    } catch (error) {
        if (!(error instanceof MathException)) fail('distributions', String(error))
    }
    return failures
}

/**
 * The checks of the numeric solutions: the roots of polynomials made of random roots found back, a root of a random
 * monotone function found in a bracket and from a guess, random linear systems solved as math.linalg solves them
 * @param math
 * @param random
 * @param index
 */
export async function checkNumeric(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const round = (value: number): number => globalThis.Math.round(value * 100) / 100
    try {
        //Roots apart from each other by 0.25 at least: real ones and pairs of conjugates
        const roots: [number, number][] = []
        const degree: number = 1 + random.int(8)
        while (roots.length < degree) {
            const re: number = round(random.next() * 8 - 4), im: number = roots.length + 1 < degree && random.chance(0.3) ? round(0.25 + random.next() * 3) : 0
            const candidates: [number, number][] = im ? [[re, -im], [re, im]] : [[re, 0]]
            if (candidates.every(([a, b]: [number, number]): boolean => roots.every(([c, d]: [number, number]): boolean => globalThis.Math.hypot(a - c, b - d) >= 0.25))) roots.push(...candidates)
        }
        const factors: string[] = []
        for (let i: number = 0; i < roots.length; i++) {
            const [re, im] = roots[i]
            if (im < 0) {
                factors.push(`(x^2 - ${2 * re}*x + ${re * re + im * im})`)
                i++
            } else if (im === 0) {
                factors.push(`(x - ${re})`)
            }
        }
        text = factors.join('*')
        //Each root near one found, each found once (their order depends on the last digits of equal real parts)
        const found = math.numeric.polynomialRoots(text, 'x')
        const unused: number[] = Array.from(found.re, (_: number, i: number): number => i)
        const matched: boolean = found.re.length === roots.length && roots.every(([re, im]: [number, number]): boolean => {
            const at: number = unused.findIndex((i: number): boolean => globalThis.Math.hypot(found.re[i] - re, found.im[i] - im) <= 1e-7 * (1 + globalThis.Math.hypot(re, im)))
            return at >= 0 && unused.splice(at, 1).length === 1
        })
        const increasing: boolean = Array.from(found.re).every((re: number, i: number): boolean => i === 0 || re > found.re[i - 1] || (re === found.re[i - 1] && found.im[i] >= found.im[i - 1]))
        if (!matched || !increasing) fail('polynomialRoots', `${Array.from(found.re).map((re: number, i: number): string => `${re}${found.im[i] ? ` + ${found.im[i]}i` : ''}`).join(', ')}`)
        //a x^3 + b x + c, a, b > 0: one root, in a bracket and from a guess
        const a: number = round(0.1 + random.next() * 5), b: number = round(0.1 + random.next() * 5), c: number = round(random.next() * 200 - 100)
        const cubic: string = `${a}*x^3 + ${b}*x + ${c}`
        text = cubic
        const bracket = math.numeric.findRoot(cubic, 'x', {bracket: [-10, 10]})
        const newton = math.numeric.findRoot(cubic, 'x', {guess: round(random.next() * 20 - 10)})
        const slope: number = 3 * a * bracket.root ** 2 + b
        //The bracket narrows to the tolerance times the root and the first bracket (20 wide)
        const residual: number = globalThis.Math.abs(a * bracket.root ** 3 + b * bracket.root + c)
        if (!bracket.converged || residual > 2e-12 * slope * (globalThis.Math.abs(bracket.root) + 20) + 1e-13 * (1 + globalThis.Math.abs(c))) fail('findRoot', `in the bracket: ${JSON.stringify(bracket)}, f ${residual}`)
        if (!newton.converged || globalThis.Math.abs(newton.root - bracket.root) > 1e-10 * (1 + globalThis.Math.abs(bracket.root))) fail('findRoot', `from a guess ${newton.root}, in the bracket ${bracket.root}`)
        //A linear system, of a dominant matrix, as math.linalg.solve solves it
        const n: number = 2 + random.int(4)
        const names: string[] = Array.from({length: n}, (_: unknown, i: number): string => `v${i}`)
        const matrix: number[][] = Array.from({length: n}, (_: unknown, i: number): number[] => Array.from({length: n}, (__: unknown, j: number): number => round(random.next() * 10 - 5) + (i === j ? 20 : 0)))
        const right: number[] = Array.from({length: n}, (): number => round(random.next() * 20 - 10))
        const equations: string[] = matrix.map((row: number[], i: number): string => `${row.map((value: number, j: number): string => `${value}*${names[j]}`).join(' + ')} = ${right[i]}`)
        text = equations.join('; ')
        const system = math.numeric.solveSystem(equations, names, new Float64Array(n))
        const exact: Float64Array = math.linalg.solve(matrix, right)
        if (!system.converged || system.solution.some((value: number, i: number): boolean => globalThis.Math.abs(value - exact[i]) > 1e-10 * (1 + globalThis.Math.abs(exact[i])))) fail('solveSystem', `${Array.from(system.solution)}, linalg ${Array.from(exact)}`)
        if ((await math.numeric.findRootAsync(cubic, 'x', {bracket: [-10, 10]})).root !== bracket.root) fail('async', 'findRootAsync differs from findRoot')
    } catch (error) {
        if (!(error instanceof MathException)) fail('numeric', String(error))
    }
    return failures
}

/**
 * The checks of the integrals: the integral of the derivative of a random formula of x is the difference of its values
 * at the ends of the interval (the formula smooth, real and finite on it, at the points sampled), and the integrals of
 * the two halves of the interval add up to it
 * @param math
 * @param random
 * @param index
 */
export async function checkIntegrate(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const round = (value: number): number => globalThis.Math.round(value * 100) / 100
    try {
        //The first of four random formulas that is usable
        let f: Expression | undefined, derivative: Expression | undefined, a: number = 0, b: number = 0, absolute: number = 0
        let values: (x: number) => number = (): number => NaN
        for (let attempt: number = 0; attempt < 4 && !derivative; attempt++) {
            const formula: string = randomFormula(random, 3)
            //Smooth: the rounding functions, the sign, the absolute value, the extrema and the parts jump or have corners
            if (/abs|sign|floor|ceil|round|arg|min|max|mod|atan2|hypot|re\(|im\(/.test(formula)) continue
            let candidate: Expression = math.expression(formula)
            const others: string[] = candidate.variables().filter((name: string): boolean => name !== 'x')
            candidate = candidate.substitute(Object.fromEntries(others.map((name: string): [string, number] => [name, round(0.5 + random.next() * 2)])))
            if (!candidate.variables().includes('x')) continue
            a = round(random.next() * 4 - 2)
            b = round(a + 0.25 + random.next() * 2)
            const slope: Expression = candidate.diff('x')
            const candidateValues = candidate.compile(['x']), slopes = slope.compile(['x'])
            //Sampled: real and finite, not too steep, without a jump (tanh(gamma(x)) at a pole of gamma: a change between
            //two points that their slopes do not explain); the integral of |f'| estimated for the tolerance
            let sum: number = 0, usable: boolean = true, previous: [number, number] | undefined
            const h: number = (b - a) / 400
            for (let k: number = 0; k <= 400 && usable; k++) {
                const x: number = a + h * k, y: number = candidateValues(x), dy: number = slopes(x)
                usable = Number.isFinite(y) && Number.isFinite(dy) && globalThis.Math.abs(dy) <= 1e6
                if (usable && previous) usable = globalThis.Math.abs(y - previous[0]) <= 4 * h * globalThis.Math.max(globalThis.Math.abs(dy), globalThis.Math.abs(previous[1])) + 1e-9 * (1 + globalThis.Math.abs(y))
                previous = [y, dy]
                sum += globalThis.Math.abs(dy) * h
            }
            if (!usable) continue
            f = candidate
            derivative = slope
            values = candidateValues
            absolute = sum
        }
        if (!f || !derivative) return failures
        text = f.toString()
        const start: number = values(a), end: number = values(b)
        const scale: number = absolute + globalThis.Math.abs(start) + globalThis.Math.abs(end)
        const whole = math.numeric.integrate(derivative, 'x', [a, b])
        //1e-7: a singularity inside the interval, not given in the points (the slope of cbrt(x) at 0), is extrapolated
        //with an error estimate that may be too small, as in QUADPACK
        if (whole.converged && globalThis.Math.abs(whole.value - (end - start)) > 1e-7 * scale + 10 * whole.error) {
            fail('integrate', `${JSON.stringify(whole)} on [${a}, ${b}], f(b) - f(a) ${end - start}`)
        }
        const middle: number = round((a + b) / 2)
        if (middle > a && middle < b) {
            const left = math.numeric.integrate(derivative, 'x', [a, middle]), right = math.numeric.integrate(derivative, 'x', [middle, b])
            if (whole.converged && left.converged && right.converged && globalThis.Math.abs(left.value + right.value - whole.value) > 1e-7 * scale + 10 * (whole.error + left.error + right.error)) {
                fail('additivity', `[${a}, ${middle}] ${left.value} + [${middle}, ${b}] ${right.value}, [${a}, ${b}] ${whole.value}`)
            }
        }
        if ((await math.numeric.integrateAsync(derivative, 'x', [a, b])).value !== whole.value) fail('async', 'integrateAsync differs from integrate')
    } catch (error) {
        if (!(error instanceof MathException)) fail('integrate', String(error))
    }
    return failures
}

/**
 * The checks of the ordinary differential equations: random stable linear systems y' = A y solved to t = 1 by both
 * methods, as e^A y0 (math.linalg.exponential), and solved back from there to y0
 * @param math
 * @param random
 * @param index
 */
export async function checkODE(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const round = (value: number): number => globalThis.Math.round(value * 100) / 100
    try {
        const n: number = 1 + random.int(4)
        const names: string[] = Array.from({length: n}, (_: unknown, i: number): string => `y${i}`)
        //Diagonally dominant with a negative diagonal: stable, its stiffness from 1 to 100
        const stiffness: number = random.chance(0.5) ? 1 : 100
        const matrix: number[][] = Array.from({length: n}, (_: unknown, i: number): number[] => Array.from({length: n}, (__: unknown, j: number): number => i === j ? -round(n + random.next() * 3) * (i === 0 ? stiffness : 1) : round(random.next() * 2 - 1)))
        const initial: number[] = Array.from({length: n}, (): number => round(random.next() * 4 - 2))
        const derivatives: string[] = matrix.map((row: number[]): string => row.map((value: number, j: number): string => `${value}*${names[j]}`).join(' + '))
        text = `${derivatives.join('; ')} from ${initial.join(', ')}`
        const exact: Float64Array = math.linalg.exponential(matrix).mul(Float64Array.from(initial)) as Float64Array
        const scale: number = 1 + globalThis.Math.max(...initial.map(globalThis.Math.abs))
        for (const method of ['rk45', 'radau'] as const) {
            const forward = math.numeric.solveODE({derivatives, states: names, span: [0, 1], initial}, {method, points: [1], relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
            const ours: number[] = Array.from({length: n}, (_: unknown, j: number): number => forward.y.get(0, j))
            if (!forward.completed || ours.some((value: number, j: number): boolean => globalThis.Math.abs(value - exact[j]) > 1e-8 * scale)) fail('solveODE', `${method}: ${ours}, e^A y0 ${Array.from(exact)}`)
            //Back from t = 1 (only the slow systems: the stiff ones grow by e^100 backward)
            if (stiffness === 1) {
                const backward = math.numeric.solveODE({derivatives, states: names, span: [1, 0], initial: Array.from(exact)}, {method, points: [0], relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
                const back: number[] = Array.from({length: n}, (_: unknown, j: number): number => backward.y.get(0, j))
                if (!backward.completed || back.some((value: number, j: number): boolean => globalThis.Math.abs(value - initial[j]) > 1e-7 * scale)) fail('backward', `${method}: ${back}, y0 ${initial}`)
            }
        }
        const async = await math.numeric.solveODEAsync({derivatives, states: names, span: [0, 1], initial}, {points: [1], relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
        const sync = math.numeric.solveODE({derivatives, states: names, span: [0, 1], initial}, {points: [1], relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
        if (Array.from(async.y.data).some((value: number, j: number): boolean => value !== sync.y.data[j])) fail('async', 'solveODEAsync differs from solveODE')
    } catch (error) {
        if (!(error instanceof MathException)) fail('solveODE', String(error))
    }
    return failures
}

/**
 * The checks of the continued fractions: of random rational numbers, their value back from their terms, the terms after
 * the first positive, the last one above 1; of the square roots of random integers, their terms as the exact
 * algorithm of quadratic irrationals gives them (m, d and a of integers)
 * @param math
 * @param random
 * @param index
 */
export async function checkContinued(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const numerator: bigint = BigInt(globalThis.Math.floor((random.next() - 0.5) * 2e12)), denominator: bigint = BigInt(1 + random.int(1e9))
        text = `${numerator}/${denominator}`
        const terms: bigint[] = math.ntheory.continuedFraction(text, {terms: 10000})
        const back: string = math.ntheory.fromContinuedFraction(terms).toString()
        if (back !== math.expression(text).toString()) fail('continuedFraction', `${terms}: ${back}`)
        if (terms.slice(1).some((term: bigint): boolean => term < 1n) || (terms.length > 1 && terms[terms.length - 1] < 2n)) fail('continuedFraction', `not canonical: ${terms}`)
        //sqrt(n) of an n that is not a square
        let n: bigint = BigInt(2 + random.int(1e6))
        const root = (value: bigint): bigint => BigInt(globalThis.Math.floor(globalThis.Math.sqrt(Number(value))))
        if (root(n) ** 2n === n) n += 1n
        text = `sqrt(${n})`
        const count: number = 5 + random.int(40)
        const a0: bigint = root(n)
        const exact: bigint[] = [a0]
        for (let m: bigint = 0n, d: bigint = 1n, a: bigint = a0; exact.length < count;) {
            m = d * a - m
            d = (n - m * m) / d
            a = (a0 + m) / d
            exact.push(a)
        }
        const ours: bigint[] = await math.ntheory.continuedFractionAsync(text, {terms: count})
        if (ours.length !== exact.length || ours.some((term: bigint, i: number): boolean => term !== exact[i])) fail('quadratic', `${ours}, exactly ${exact}`)
    } catch (error) {
        if (!(error instanceof MathException)) fail('continuedFraction', String(error))
    }
    return failures
}

/**
 * The checks of the matrices of expressions: random matrices of rationals against math.linalg (the determinant, the
 * inverse, the solution of a system, the rank) and their inverse times them the identity, exactly; random matrices
 * with variables at random values against the numbers; the characteristic polynomial at a value as det(x I - A); the
 * text read back as the same matrix
 * @param math
 * @param random
 * @param index
 */
export async function checkExpressionMatrix(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const near = (a: number, b: number, scale: number): boolean => globalThis.Math.abs(a - b) <= 1e-8 * (1 + scale)
    try {
        const n: number = 1 + random.int(4)
        //Small integers and halves; a row made of others now and then (singular)
        const rows: number[][] = Array.from({length: n}, (): number[] => Array.from({length: n}, (): number => (random.int(13) - 6) / (random.chance(0.2) ? 2 : 1)))
        if (n > 1 && random.chance(0.2)) rows[n - 1] = rows[0].map((value: number, j: number): number => value + rows[1][j])
        const a = math.expressionMatrix(rows)
        text = a.toString()
        const numbers = math.matrix(rows)
        const scale: number = rows.flat().reduce((m: number, v: number): number => globalThis.Math.max(m, globalThis.Math.abs(v)), 1) ** n
        const determinant: number = a.determinant().toNumber()
        if (!near(determinant, math.linalg.determinant(numbers), scale)) fail('determinant', `${determinant}, linalg ${math.linalg.determinant(numbers)}`)
        if (a.rank() !== math.linalg.rank(numbers)) fail('rank', `${a.rank()}, linalg ${math.linalg.rank(numbers)}`)
        if (!math.parse(text).toString().startsWith('[') || !a.equals(text)) fail('text', 'not read back')
        if (determinant !== 0) {
            const inverse = a.inverse()
            const identity = math.expressionMatrix(math.linalg.identity(n))
            if (!inverse.mul(a).equals(identity)) fail('inverse', `${inverse.toString()} times the matrix is not the identity`)
            if (!inverse.toMatrix().equals(math.linalg.inverse(numbers), 1e-9 * scale)) fail('inverse', `${inverse.toString()}, linalg ${math.linalg.inverse(numbers).toString()}`)
            const b: number[] = Array.from({length: n}, (): number => random.int(11) - 5)
            const solution = a.solve(b).toMatrix().data, expected = math.linalg.solve(numbers, b)
            if (Array.from(solution).some((value: number, i: number): boolean => !near(value, expected[i], scale))) fail('solve', `${Array.from(solution)}, linalg ${Array.from(expected)}`)
        }
        //det(x I - A) at a value of x
        const value: number = random.int(9) - 4
        const shifted = math.expressionMatrix(math.linalg.identity(n)).mul(value).sub(a)
        if (a.characteristicPolynomial('x').substitute({x: value}).toNumber() !== shifted.determinant().toNumber()) fail('characteristicPolynomial', `at ${value}`)
        //With variables: at values of them, as the numbers
        const size: number = 2 + random.int(2)
        const pick = (): string => random.pick(['x', 'y', 'x*y', 'x^2', '2x - y', '1', '3', '-2', 'x + 1', 'y - 2'])
        const symbolic = math.expressionMatrix(Array.from({length: size}, (): string[] => Array.from({length: size}, pick)))
        text = symbolic.toString()
        const at: Record<string, number> = {x: (random.int(17) - 8) / 4, y: (random.int(17) - 8) / 3}
        const substituted = symbolic.substitute(at)
        const symbolicDeterminant: number = symbolic.determinant().substitute(at).toNumber(), numericDeterminant: number = substituted.determinant().toNumber()
        if (!near(symbolicDeterminant, numericDeterminant, globalThis.Math.abs(numericDeterminant))) fail('determinant', `with variables ${symbolicDeterminant}, at the values ${numericDeterminant}`)
        if (numericDeterminant !== 0 && symbolic.determinant().toString() !== '0') {
            const inverse = symbolic.inverse().substitute(at).toMatrix(), expected = substituted.inverse().toMatrix()
            if (!inverse.equals(expected, 1e-9 * (1 + globalThis.Math.max(...Array.from(expected.data, globalThis.Math.abs))))) fail('inverse', `with variables ${inverse.toString()}, at the values ${expected.toString()}`)
        }
        if ((await symbolic.determinantAsync()).toString() !== symbolic.determinant().toString()) fail('async', 'determinantAsync differs from determinant')
    } catch (error) {
        if (!(error instanceof MathException)) fail('expressionMatrix', String(error))
    }
    return failures
}

//The units of the table by their quantities, with their prefixes (VAR, an imaginary unit, left out)
const UNITS_BY_QUANTITY: Map<string, string[]> = new Map()
for (const [name, definition] of Object.entries(UNITS)) {
    if (definition.value === 'i') continue
    const names: string[] = UNITS_BY_QUANTITY.get(definition.quantity) ?? []
    names.push(...Object.keys(PREFIXES[definition.prefixes]!).map((prefix: string): string => prefix + name))
    UNITS_BY_QUANTITY.set(definition.quantity, names)
}
const QUANTITY_NAMES: string[] = [...UNITS_BY_QUANTITY.keys()].filter((quantity: string): boolean => quantity !== 'NONE' && QUANTITIES[quantity] !== undefined)

/**
 * Units: a value converted to another unit of its quantity and back is the same, exactly; its text is read back; the
 * dimensions add under products, subtract under quotients and scale under powers; the values in SI units of sums and
 * products are the sums and the products of theirs, exactly; the parts of split() add up to the value
 * @param math
 * @param random
 * @param index
 */
export async function checkUnits(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    const number = (): string => `${random.int(2001) - 1000}${random.chance(0.5) ? `/${random.pick([2, 3, 4, 5, 7, 8, 10, 1000])}` : ''}`
    const value = (quantity: string): Unit => math.unit(number(), random.pick(UNITS_BY_QUANTITY.get(quantity)!))
    const dimensions = (unit: Unit): number[] => Object.values(unit.dimensions as UnitDimensions)
    //The temperatures with an offset: degC and degF, with their prefixes
    const offset = (units: string): boolean => /(degC|degF|celsius|fahrenheit)$/.test(units)
    try {
        const quantity: string = random.pick(QUANTITY_NAMES)
        const a: Unit = value(quantity)
        text = a.toString()
        const other: string = random.pick(UNITS_BY_QUANTITY.get(quantity)!)
        const converted: Unit = a.to(other)
        if (!converted.to(a.units).value.equals(a.value)) fail('roundtrip', `${text} to ${other} and back: ${converted.to(a.units).toString()}`)
        if (!converted.equals(a)) fail('roundtrip', `${converted.toString()} is not ${text}`)
        const read: Unit = math.unit(text)
        if (!read.equals(a) || read.units !== a.units) fail('text', `read back as ${read.toString()}`)
        if (offset(a.units) || offset(other)) return failures
        //The conversion as numbers: by the values of the units in SI units
        const factor = (name: string): number => math.unit(1, name).toSI().value.toNumber()
        const expected: number = (a.value.toNumber() * factor(a.units)) / factor(other)
        if (globalThis.Math.abs(converted.value.toNumber() - expected) > 1e-12 * globalThis.Math.abs(expected)) fail('convert', `${converted.toString()}, by numbers ${expected}`)
        const b: Unit = value(random.pick(QUANTITY_NAMES)), c: Unit = value(quantity)
        if (offset(b.units) || offset(c.units)) return failures
        text = `${a.toString()}; ${b.toString()}; ${c.toString()}`
        const k: number = random.int(7) - 3
        if (dimensions(a.mul(b)).some((power: number, i: number): boolean => power !== dimensions(a)[i]! + dimensions(b)[i]!)) fail('dimensions', 'of a product')
        if (dimensions(a.div(b)).some((power: number, i: number): boolean => power !== dimensions(a)[i]! - dimensions(b)[i]!)) fail('dimensions', 'of a quotient')
        if (dimensions(a.pow(k)).some((power: number, i: number): boolean => power !== k * dimensions(a)[i]!)) fail('dimensions', `of a power ${k}`)
        const si = (unit: Unit): Expression => unit.toSI().value
        if (!si(a.mul(b)).equals(si(a).mul(si(b)))) fail('arithmetic', `the product: ${a.mul(b).toString()}`)
        if (!b.value.isZero() && !si(a.div(b)).equals(si(a).div(si(b)))) fail('arithmetic', `the quotient: ${a.div(b).toString()}`)
        if (!si(a.add(c)).equals(si(a).add(si(c)))) fail('arithmetic', `the sum: ${a.add(c).toString()}`)
        if (!si(a.sub(c)).equals(si(a).sub(si(c)))) fail('arithmetic', `the difference: ${a.sub(c).toString()}`)
        if (!si(math.unit(`${a.toString()} + ${c.toString()}`)).equals(si(a.add(c)))) fail('formula', `the sum read: ${a.toString()} + ${c.toString()}`)
        const parts: Unit[] = a.split([other, a.units])
        if (!parts[0]!.add(parts[1]!).equals(a)) fail('split', `${parts.map(String).join(', ')}`)
        if (!a.value.isZero() && !a.toBest().equals(a)) fail('toBest', `${a.toBest().toString()}`)
    } catch (error) {
        if (!(error instanceof MathException)) fail('units', String(error))
    }
    return failures
}

//A random polynomial in x (and y): a few terms of small integer coefficients, degrees up to 3
function randomPolynomial(random: Random, variables: readonly string[]): string {
    const terms: string[] = []
    const count: number = 1 + random.int(4)
    for (let k = 0; k < count; k++) {
        const coefficient: number = random.int(13) - 6 || 1
        const powers: string = variables.map((variable: string): string => {
            const degree: number = random.int(4)
            return degree ? `*${variable}^${degree}` : ''
        }).join('')
        terms.push(`(${coefficient})${powers}`)
    }
    return terms.join(' + ')
}

/**
 * Polynomials: the gcd of a g and b g is divided by g and divides both (by the long division of SymEngine, in x over
 * the rational functions of y); lcm gcd is a b times a constant; the resultant in x is 0 exactly when the gcd has x in
 * it; the discriminant of a polynomial with a square factor in x is 0
 * @param math
 * @param random
 * @param index
 */
export async function checkPolynomials(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const variables: string[] = random.chance(0.5) ? ['x'] : ['x', 'y']
        const a: string = randomPolynomial(random, variables), b: string = randomPolynomial(random, variables), g: string = randomPolynomial(random, variables)
        const A = math.expression(`(${a})*(${g})`).expand(), B = math.expression(`(${b})*(${g})`).expand()
        text = `a = ${a}; b = ${b}; g = ${g}`
        if (A.isZero() === true || B.isZero() === true) return failures
        //Divisibility in x, checked where y is a few integers (it holds there): the long division of polynomials of
        //rational coefficients is exact
        const divides = (divisor: Expression, dividend: Expression): boolean => [2, 3, -1].every((y: number): boolean => {
            const d: Expression = divisor.substitute({y: y}).expand(), n: Expression = dividend.substitute({y: y}).expand()
            if (d.degree('x') <= 0 || d.degree('x') < divisor.degree('x')) return true
            return n.divide(d, 'x').remainder.expand().isZero() === true
        })
        const h: Expression = math.poly.gcd(A, B)
        if (!divides(h, A) || !divides(h, B)) fail('gcd', `${h.toString()} does not divide both`)
        const G = math.expression(g).expand()
        if (G.degree('x') > 0 && !divides(G, h)) fail('gcd', `${h.toString()} is not divided by g`)
        //lcm gcd / (A B) is a constant: the same at two points
        const l: Expression = math.poly.lcm(A, B)
        const ratio = (point: Record<string, number>): Expression | undefined => {
            const denominator: Expression = A.mul(B).substitute(point)
            return denominator.isZero() === true ? undefined : l.mul(h).substitute(point).div(denominator)
        }
        const first = ratio({x: 2, y: 3}), second = ratio({x: -3, y: 5})
        if (first && second && !first.equals(second)) fail('lcm', `lcm gcd / (a b) is ${first.toString()} and ${second.toString()}`)
        const resultant: Expression = math.poly.resultant(A, B, 'x')
        const common: boolean = h.degree('x') > 0
        if ((resultant.isZero() === true) !== common) fail('resultant', `${resultant.toString()} for a gcd of degree ${h.degree('x')} in x`)
        if (G.degree('x') > 0) {
            const square = math.expression(`(${a})*(${g})^2`).expand()
            if (math.poly.discriminant(square, 'x').isZero() !== true) fail('discriminant', `not 0 for a square factor`)
        }
        if (!(await math.poly.gcdAsync([A, B])).equals(h)) fail('async', 'gcdAsync differs from gcd')
    } catch (error) {
        if (!(error instanceof MathException)) fail('polynomials', String(error))
    }
    return failures
}

/**
 * Factorizations: the factors multiplied back are the polynomial; each factor is irreducible again (its factorization
 * is itself); the square-free factors are square free and coprime; factor() equals the polynomial
 * @param math
 * @param random
 * @param index
 */
export async function checkFactor(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const variables: string[] = random.chance(0.5) ? ['x'] : ['x', 'y']
        const parts: string[] = Array.from({length: 1 + random.int(3)}, (): string => randomPolynomial(random, variables))
        const power: number = 1 + random.int(2)
        const p: Expression = math.expression(`${random.int(7) - 3 || 1}*(${parts.join(')*(')})^${power}`).expand()
        text = p.toString()
        const list = math.poly.factorList(p)
        const product: Expression = list.factors.reduce((q: Expression, f): Expression => q.mul(f.factor.pow(f.multiplicity)), list.coefficient)
        if (!product.expand().equals(p)) fail('factor', `the factors multiplied back are ${product.expand().toString()}`)
        for (const {factor} of list.factors) {
            const again = math.poly.factorList(factor)
            if (again.factors.length !== 1 || again.factors[0]!.multiplicity !== 1 || !again.coefficient.equals(1) || !again.factors[0]!.factor.equals(factor)) {
                fail('factor', `${factor.toString()} factors again into ${again.factors.map((f): string => f.factor.toString()).join(', ')}`)
            }
        }
        if (!p.factor().equals(p)) fail('factor', `factor() is ${p.factor().toString()}`)
        const sqf = math.poly.sqfList(p)
        const sqfProduct: Expression = sqf.factors.reduce((q: Expression, f): Expression => q.mul(f.factor.pow(f.multiplicity)), sqf.coefficient)
        if (!sqfProduct.expand().equals(p)) fail('sqf', `the factors multiplied back are ${sqfProduct.expand().toString()}`)
        for (const [i, {factor}] of sqf.factors.entries()) {
            for (const variable of variables) {
                const derivative: Expression = factor.diff(variable)
                if (derivative.isZero() !== true && math.poly.gcd(factor, derivative).degree(variable) > 0) fail('sqf', `${factor.toString()} is not square free`)
            }
            for (const other of sqf.factors.slice(i + 1)) {
                if (variables.some((variable: string): boolean => math.poly.gcd(factor, other.factor).degree(variable) > 0)) fail('sqf', `${factor.toString()} and ${other.factor.toString()} are not coprime`)
            }
        }
        const asynchronous = await math.poly.factorListAsync(p)
        if (asynchronous.factors.length !== list.factors.length || asynchronous.factors.some((f, i: number): boolean => !f.factor.equals(list.factors[i]!.factor))) fail('async', 'factorListAsync differs from factorList')
    } catch (error) {
        if (!(error instanceof MathException)) fail('factor', String(error))
    }
    return failures
}

/**
 * Fractions of polynomials: cancel() of A G/(B G) equals it, its numerator and its denominator coprime; together() of
 * a sum of fractions and apart() equal what they were given, at an exact point too; completeSquare() of a quadratic,
 * expanded, is the quadratic.
 */
export async function checkRational(math: MathScope, random: Random, index: number): Promise<FuzzFailure[]> {
    const failures: FuzzFailure[] = []
    let text: string = ''
    const fail = (property: string, message: string): number => failures.push({index, text, property, message})
    try {
        const variables: string[] = random.chance(0.5) ? ['x'] : ['x', 'y']
        const [a, b, g] = [0, 1, 2].map((): string => randomPolynomial(random, variables))
        const denominator: Expression = math.expression(`(${b})*(${g})`).expand()
        if (denominator.isZero() === true) return failures
        const fraction: Expression = math.expression(`(${a})*(${g})`).expand().div(denominator)
        text = fraction.toString()
        //An exact point where the denominators are not 0
        const point: Record<string, string> = {x: '7/3', y: '-5/11'}
        const at = (e: Expression): Expression => e.substitute(Object.fromEntries(variables.map((v: string): [string, string] => [v, point[v]!])))
        const value = (e: Expression): Expression | undefined => {
            try {
                const result: Expression = at(e)
                return result.isFinite() === true ? result : undefined
            } catch {
                return undefined
            }
        }
        const cancelled: Expression = fraction.cancel()
        if (!cancelled.equals(fraction)) fail('cancel', `cancel() is ${cancelled.toString()}`)
        const top: Expression = cancelled.numerator(), bottom: Expression = cancelled.denominator()
        if (variables.some((variable: string): boolean => math.poly.gcd(top, bottom).degree(variable) > 0)) fail('cancel', `${top.toString()} and ${bottom.toString()} are not coprime`)
        const otherDenominator: Expression = math.expression(randomPolynomial(random, variables))
        const other: Expression = otherDenominator.isZero() === true ? math.expression(1) : math.expression(randomPolynomial(random, variables)).div(otherDenominator)
        const sum: Expression = fraction.add(other)
        const together: Expression = sum.together()
        if (!together.equals(sum)) fail('together', `together() of ${sum.toString()} is ${together.toString()}`)
        const apart: Expression = fraction.apart('x')
        if (!apart.equals(fraction)) fail('apart', `apart() is ${apart.toString()}`)
        const expected: Expression | undefined = value(fraction)
        if (expected !== undefined) {
            for (const [property, result] of [['cancel', cancelled], ['apart', apart]] as const) {
                const found: Expression | undefined = value(result)
                if (found !== undefined && !found.equals(expected)) fail(property, `${result.toString()} is ${found.toString()} at ${JSON.stringify(point)}, not ${expected.toString()}`)
            }
        }
        if (!(await fraction.apartAsync('x')).equals(apart)) fail('async', 'apartAsync differs from apart')
        const quadratic: Expression = math.expression(`(${random.int(9) - 4 || 2})*x^2 + (${randomPolynomial(random, variables.slice(1))})*x + ${random.int(9) - 4}`)
        const square: Expression = quadratic.completeSquare('x')
        if (!square.expand().equals(quadratic.expand())) fail('completeSquare', `completeSquare() of ${quadratic.toString()} is ${square.toString()}`)
    } catch (error) {
        if (!(error instanceof MathException)) fail('rational', String(error))
    }
    return failures
}
