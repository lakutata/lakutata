import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {readFileSync} from 'node:fs'
import {Container} from '@lakutata/core'
import {type Expression, Math, MathException, type Solutions, type SystemSolution} from '../exports/Math.js'

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
        const fixtures = expected<{text: string, value: Complex, decimals?: Record<string, string>}>('numbers')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            assert.ok(close(expression.toComplex(), fixture.value, 1e-13), `${fixture.text}: ${JSON.stringify(expression.toComplex())}, SymPy ${fixture.value.join(' + i*')}`)
            //The compiled function of a real value gives it too
            if (Number(fixture.value[1]) === 0) assert.ok(close({re: expression.compile([])(), im: 0}, fixture.value, 1e-13), `${fixture.text} compiled: ${expression.compile([])()}`)
            for (const [digits, text] of Object.entries(fixture.decimals ?? {})) {
                assert.strictEqual(decimalParts(expression.toDecimal(Number(digits))), decimalParts(text), `${fixture.text} to ${digits} digits`)
            }
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
