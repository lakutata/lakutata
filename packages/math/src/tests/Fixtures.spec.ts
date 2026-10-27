import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {readFileSync} from 'node:fs'
import {Container} from '@lakutata/core'
import {type Decimal, Expression, Math, MathException, Matrix, type PrimeFactor, type Solutions, type SystemSolution} from '../exports/Math.js'

//The results of SymPy (test-env/fixtures/generate.sh): the values of each result at the sample points, 30 digits
type Complex = [string, string]
type Point = Record<string, string>

interface Expected<T> {
    points: Point[]
    cases: T[]
}

function expected<T>(name: string): Expected<T> {
    return JSON.parse(readFileSync(new URL(`../../../test-env/fixtures/expected/${name}.json`, import.meta.url), 'utf8'))
}

//The value of an expression at a point, or the reason it has none
function valueAt(expression: Expression, point: Point): {re: number, im: number} | string {
    try {
        return expression.substitute(point).toComplex()
    } catch (error) {
        return String((error as Error).message)
    }
}

function close(value: {re: number, im: number} | string, expected: Complex, tolerance: number): boolean {
    if (typeof value === 'string') return false
    const re: number = Number(expected[0]), im: number = Number(expected[1])
    const scale: number = globalThis.Math.max(1, globalThis.Math.hypot(re, im))
    return globalThis.Math.abs(value.re - re) <= tolerance * scale && globalThis.Math.abs(value.im - im) <= tolerance * scale
}

//The values of an expression at the points match SymPy's (the points where SymPy has none are skipped)
function assertValues(expression: Expression, points: Point[], values: (Complex | null)[], label: string, tolerance: number = 1e-9): void {
    points.forEach((point: Point, index: number): void => {
        const value: Complex | null = values[index]
        if (value === null) return
        const ours = valueAt(expression, point)
        assert.ok(close(ours, value, tolerance), `${label} at ${JSON.stringify(point)}: ${JSON.stringify(ours)}, SymPy ${value.join(' + i*')} (${expression.toString()})`)
    })
}

//A decimal as its significant digits and the exponent of the first one: 1.4142e+3 and 1414.2 are the same
function decimalParts(text: string): string {
    const match: RegExpMatchArray | null = /^(-?)(\d*)\.?(\d*)(?:e([-+]?\d+))?$/.exec(text.trim())
    if (!match) return text
    const digits: string = (match[2] + match[3]).replace(/^0+/, '')
    const leadingZeros: number = (match[2] + match[3]).length - (match[2] + match[3]).replace(/^0+/, '').length
    const exponent: number = Number(match[4] ?? 0) + match[2].length - 1 - leadingZeros
    return `${match[1]}${digits.replace(/0+$/, '')}e${exponent}`
}

describe('The fixtures (SymPy, mathjs, nerdamer)', (): void => {
    let container: Container
    let math: Math

    before(async (): Promise<void> => {
        container = new Container()
        await container.setNamed('math', Math, {})
        math = await container.get<Math>('math')
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('read the formulas as SymPy reads their meaning', (): void => {
        const fixtures = expected<{text: string, values?: (Complex | null)[], error?: string}>('grammar')
        for (const fixture of fixtures.cases) {
            if (fixture.error) {
                assert.throws((): unknown => math.expression(fixture.text), (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, fixture.text)
                continue
            }
            assertValues(math.expression(fixture.text), fixtures.points, fixture.values!, fixture.text)
        }
    })

    it('give the numbers and the decimals of SymPy', (): void => {
        const fixtures = expected<{text: string, value: Complex, decimals?: Record<string, string>, doubles?: string}>('numbers')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            assert.ok(close(expression.toComplex(), fixture.value, 1e-13), `${fixture.text}: ${JSON.stringify(expression.toComplex())}, SymPy ${fixture.value.join(' + i*')}`)
            //The compiled function of a real value gives it too, but where the doubles cannot hold it (the case says why)
            if (Number(fixture.value[1]) === 0 && !fixture.doubles) assert.ok(close({re: expression.compile([])(), im: 0}, fixture.value, 1e-13), `${fixture.text} compiled: ${expression.compile([])()}`)
            for (const [digits, text] of Object.entries(fixture.decimals ?? {})) {
                assert.strictEqual(decimalParts(expression.toDecimal(Number(digits))), decimalParts(text), `${fixture.text} to ${digits} digits`)
            }
        }
    })

    it('give the decimals of the special functions of SymPy (mpmath)', (): void => {
        const fixtures = expected<{text: string, decimals: Record<string, string>}>('special')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            for (const [digits, text] of Object.entries(fixture.decimals)) {
                assert.strictEqual(decimalParts(expression.toDecimal(Number(digits))), decimalParts(text), `${fixture.text} to ${digits} digits`)
            }
        }
    })

    it('give the complex decimals of SymPy, each part to its digits, on and off the branch cuts', (): void => {
        const fixtures = expected<{text: string, decimals: Record<string, [string, string]>}>('complex')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            for (const [digits, [re, im]] of Object.entries(fixture.decimals)) {
                const value: {re: string, im: string} = expression.toComplexDecimal(Number(digits))
                assert.strictEqual(decimalParts(value.re), decimalParts(re), `re(${fixture.text}) to ${digits} digits`)
                assert.strictEqual(decimalParts(value.im), decimalParts(im), `im(${fixture.text}) to ${digits} digits`)
            }
        }
    })

    it('give the decimals of Python (arithmetic) and mpmath (functions), correctly rounded', (): void => {
        const fixtures = expected<{op: string, precision: number, args: string[], result: string}>('decimals')
        for (const fixture of fixtures.cases) {
            const [first, second] = fixture.args
            const decimal: Decimal = math.decimal(first, {precision: fixture.precision})
            const operations: Record<string, () => Decimal | string> = {
                round: (): Decimal => decimal,
                root: (): Decimal => decimal.root(Number(second)),
                roundTo: (): Decimal => decimal.round(Number(second)),
                fixed: (): string => decimal.toFixed(Number(second))
            }
            const operate: () => Decimal | string = operations[fixture.op] ?? ((): Decimal => (decimal[fixture.op as keyof Decimal] as (value?: string) => Decimal).call(decimal, second))
            assert.strictEqual(String(operate()), fixture.result, `${fixture.op}(${fixture.args.join(', ')}) to ${fixture.precision} digits`)
        }
    })

    it('give the linear algebra of NumPy and SciPy', (): void => {
        type Nested = number | Nested[]
        const fixtures = expected<{op: string, args: (number[][] | number[])[], triangle?: 'lower' | 'upper', tolerance?: number, kind?: number | 'fro' | 'inf', result?: Nested, error?: string}>('linalg')
        //The elements of a result, flat
        const flat = (value: unknown): number[] => {
            if (typeof value === 'number') return [value]
            if (value instanceof Matrix) return Array.from(value.data)
            if (value instanceof Float64Array) return Array.from(value)
            return (value as Nested[]).flatMap((element: Nested): number[] => flat(element))
        }
        for (const fixture of fixtures.cases) {
            const [a, b] = fixture.args as [number[][], number[][] & number[]]
            const label: string = `${fixture.op}(${JSON.stringify(fixture.args).slice(0, 80)})`
            const operate = (): unknown => {
                switch (fixture.op) {
                    case 'multiply': return math.linalg.multiply(a, b)
                    case 'solve': return math.linalg.solve(a, b)
                    case 'solveTriangular': return math.linalg.solveTriangular(a, b, fixture.triangle!)
                    case 'leastSquares': return math.linalg.leastSquares(a, b)
                    case 'inverse': return math.linalg.inverse(a)
                    case 'determinant': return math.linalg.determinant(a)
                    case 'rank': return math.linalg.rank(a, fixture.tolerance ?? undefined)
                    case 'singularValues': return math.linalg.singularValues(a)
                    case 'condition': return math.linalg.condition(a)
                    case 'norm': return math.linalg.norm(fixture.args[0], fixture.kind === 'inf' ? Infinity : fixture.kind)
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) {
                assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            const ours: number[] = flat(operate()), theirs: number[] = flat(fixture.result)
            const scale: number = globalThis.Math.max(1, ...theirs.map(globalThis.Math.abs))
            assert.strictEqual(ours.length, theirs.length, label)
            ours.forEach((value: number, i: number): void => {
                assert.ok(globalThis.Math.abs(value - theirs[i]) <= 1e-11 * scale, `${label}: ${value}, NumPy ${theirs[i]}`)
            })
        }
    })

    it('expand as SymPy, to the same canonical form', (): void => {
        const fixtures = expected<{text: string, result: string, values: (Complex | null)[]}>('expand')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).expand()
            assert.strictEqual(ours.toString(), math.expression(fixture.result).expand().toString(), fixture.text)
            assertValues(ours, fixtures.points, fixture.values, fixture.text)
        }
    })

    it('derive as SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, times?: number, result: string, values: (Complex | null)[]}>('diff')
        for (const fixture of fixtures.cases) {
            assertValues(math.expression(fixture.text).diff(fixture.variable, fixture.times ?? 1), fixtures.points, fixture.values, `d/d${fixture.variable} ${fixture.text}`)
        }
    })

    it('give the series of SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, point: string, order: number, result: string, values: (Complex | null)[]}>('series')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).series(fixture.variable, fixture.point, fixture.order)
            assert.strictEqual(ours.expand().toString(), math.expression(fixture.result).expand().toString(), `${fixture.text} at ${fixture.point}`)
        }
    })

    it('substitute as SymPy', (): void => {
        const fixtures = expected<{text: string, with: Record<string, string>, result: string}>('substitute')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).substitute(fixture.with)
            assert.ok(ours.equals(fixture.result), `${fixture.text} with ${JSON.stringify(fixture.with)}: ${ours.toString()}, SymPy ${fixture.result}`)
        }
    })

    it('solve the equations as SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, domain?: 'real', kind: string, solutions?: {text: string, values: (Complex | null)[]}[]}>('solve')
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.text} = 0${fixture.domain ? ' in the reals' : ''}`
            const solutions: Solutions = math.expression(fixture.text).solve(fixture.variable, {domain: fixture.domain})
            assert.strictEqual(solutions.kind, fixture.kind, label)
            if (fixture.kind !== 'finite') continue
            assert.strictEqual(solutions.length, fixture.solutions!.length, `${label}: ${solutions.map(String).join(', ')}`)
            fixtures.points.forEach((point: Point, index: number): void => {
                const ours = solutions.map((solution: Expression) => valueAt(solution, point))
                for (const solution of fixture.solutions!) {
                    const value: Complex | null = solution.values[index]
                    if (value === null) continue
                    const found: number = ours.findIndex((candidate) => close(candidate, value, 1e-9))
                    assert.ok(found >= 0, `${label}: SymPy's ${solution.text} is not among ${solutions.map(String).join(', ')}`)
                    ours.splice(found, 1)
                }
            })
        }
    })

    it('give the coefficients, the degrees and the divisions of polynomials as SymPy', (): void => {
        type Value = {text: string, values: (Complex | null)[]}
        const fixtures = expected<{text: string, variable: string, divisor?: string, degree: number, coefficients: Value[], quotient?: Value, remainder?: Value}>('polynomials')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text)
            assert.strictEqual(ours.degree(fixture.variable), fixture.degree, `${fixture.text}: degree`)
            const coefficients: Expression[] = ours.coefficients(fixture.variable)
            assert.strictEqual(coefficients.length, fixture.coefficients.length, `${fixture.text}: ${coefficients.map(String).join(', ')}`)
            coefficients.forEach((coefficient: Expression, index: number): void => assertValues(coefficient, fixtures.points, fixture.coefficients[index].values, `${fixture.text}: coefficient ${index}`))
            if (!fixture.divisor) continue
            const {quotient, remainder} = ours.divide(fixture.divisor, fixture.variable)
            assertValues(quotient, fixtures.points, fixture.quotient!.values, `${fixture.text} / ${fixture.divisor}: quotient`)
            assertValues(remainder, fixtures.points, fixture.remainder!.values, `${fixture.text} / ${fixture.divisor}: remainder`)
        }
    })

    it('give the number theory of SymPy', (): void => {
        const fixtures = expected<{op: string, args: (string | string[])[], error?: string, result?: unknown}>('ntheory')
        const ntheory = math.ntheory as unknown as Record<string, (...args: unknown[]) => unknown>
        //A result as the fixtures write it: integers as decimal strings, null for no value
        const written = (op: string, value: unknown): unknown => {
            if (value === undefined) return null
            if (typeof value === 'bigint') return String(value)
            if (value instanceof Expression) return value.toString()
            if (op === 'factor') return (value as PrimeFactor[]).map((factor: PrimeFactor): unknown[] => [String(factor.prime), factor.exponent])
            if (op === 'extendedGcd') return [(value as {gcd: bigint}).gcd, (value as {x: bigint}).x, (value as {y: bigint}).y].map(String)
            if (op === 'crt') return [(value as {remainder: bigint}).remainder, (value as {modulus: bigint}).modulus].map(String)
            return value
        }
        for (const fixture of fixtures.cases) {
            const args: unknown[] = fixture.args.map((arg: string | string[]): unknown => Array.isArray(arg) ? arg.map(BigInt) : BigInt(arg))
            const label: string = `${fixture.op}(${fixture.args.map((arg: string | string[]): string => JSON.stringify(arg)).join(', ')})`
            const call = (): unknown => fixture.op === 'gcd' || fixture.op === 'lcm' ? ntheory[fixture.op](...(args[0] as bigint[])) : ntheory[fixture.op](...args)
            if (fixture.error) {
                assert.throws(call, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            assert.deepStrictEqual(written(fixture.op, call()), fixture.result, label)
        }
    })

    it('solve the linear systems as SymPy', (): void => {
        const fixtures = expected<{equations: string[], variables: string[], kind: string, values?: Record<string, {text: string, values: (Complex | null)[]}>}>('systems')
        for (const fixture of fixtures.cases) {
            const label: string = fixture.equations.join(', ')
            const solutions: SystemSolution[] = math.solve(fixture.equations, fixture.variables)
            if (fixture.kind === 'empty') {
                assert.deepStrictEqual(solutions, [], label)
                continue
            }
            assert.strictEqual(solutions.length, 1, label)
            assert.deepStrictEqual(Object.keys(solutions[0]).sort(), Object.keys(fixture.values!).sort(), label)
            for (const [name, value] of Object.entries(fixture.values!)) assertValues(solutions[0][name], fixtures.points, value.values, `${label}: ${name}`)
        }
    })
})
