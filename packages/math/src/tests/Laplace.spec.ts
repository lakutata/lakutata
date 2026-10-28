import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathArgumentException, MathNotSupportedException, type MathScope} from '../exports/Math.js'

describe('The Laplace transforms', (): void => {
    const math: MathScope = createMath()
    const transform = (formula: string): string => math.expression(formula).laplace('t', 's').toString()
    const inverse = (formula: string): string => math.expression(formula).inverseLaplace('s', 't').toString()

    it('transform by the table, shifts in s and derivatives in s', (): void => {
        const cases: [string, string][] = [
            ['1', '1/s'],
            ['t^3', '6/s^4'],
            ['sqrt(t)', 'sqrt(pi)/(2s^(3/2))'],
            ['t^2*e^(-3t)', '2/(s + 3)^3'],
            ['sin(2t)', '2/(s^2 + 4)'],
            ['sinh(t)', '1/(s^2 - 1)'],
            ['e^(2t)*cos(3t)', '(s - 2)/((s - 2)^2 + 9)'],
            ['t*sin(t)', '2s/(s^2 + 1)^2'],
            ['sin(t)^2', '2/(s^3 + 4s)'],
            ['3 + 2t - e^t', '-1/(s - 1) + 2/s^2 + 3/s']
        ]
        for (const [formula, expected] of cases) assert.strictEqual(transform(formula), expected, formula)
    })

    it('invert by partial fractions, powers of s - a and shifts in t', (): void => {
        const cases: [string, string][] = [
            ['1/s^3', 't^2/2'],
            ['1/(s^2 + 2s + 5)', 'e^(-t)*sin(2t)/2'],
            ['1/(s*(s + 1))', '-e^(-t) + 1'],
            ['1/(s + 1)^3', 'e^(-t)*t^2/2'],
            ['1/sqrt(s)', '1/(sqrt(pi)*sqrt(t))'],
            ['1/(s^2 - 2)', 'sinh(t*sqrt(2))*sqrt(2)/2'],
            ['e^(-2s)/s', 'piecewise(0, t < 2, 1)']
        ]
        for (const [formula, expected] of cases) assert.strictEqual(inverse(formula), expected, formula)
        //Its transform again
        for (const formula of ['1/(s^2 + 1)^2', 's/(s^2 + 4)^2', '(2s + 3)/(s^2 + 4s + 13)']) {
            assert.ok(math.expression(inverse(formula)).laplace('t', 's').sub(formula).cancel().isZero(), formula)
        }
    })

    it('refuse what is not found and wrong variables', async (): Promise<void> => {
        assert.throws((): string => transform('tan(t)'), MathNotSupportedException)
        assert.throws((): string => inverse('s^2/(s^2 + 1)'), MathNotSupportedException)
        assert.throws((): string => math.expression('t*s').laplace('t', 's').toString(), MathArgumentException)
        assert.throws((): string => math.expression('t').laplace('t', 't').toString(), MathArgumentException)
        assert.strictEqual((await math.expression('e^(-t)').laplaceAsync('t', 's')).toString(), '1/(s + 1)')
        assert.strictEqual((await math.expression('1/(s + 1)').inverseLaplaceAsync('s', 't')).toString(), 'e^(-t)')
    })
})
