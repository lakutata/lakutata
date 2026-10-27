import {type Expression, Math, MathException, Matrix} from '../../exports/Math.js'

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
function randomMatrix(math: Math, random: Random, rows: number, columns: number): Matrix {
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
export async function checkMatrices(math: Math, random: Random, index: number): Promise<FuzzFailure[]> {
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
export function checkText(math: Math, index: number, text: string): FuzzFailure[] {
    try {
        math.parse(text)
        return []
    } catch (error) {
        return error instanceof MathException ? [] : [{index, text, property: 'parse', message: `not a MathException: ${String(error)}`}]
    }
}
