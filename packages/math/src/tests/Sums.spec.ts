import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathArgumentException, MathNotSupportedException, type MathScope, MathSyntaxException} from '../exports/Math.js'

describe('The sums and the products', (): void => {
    const math: MathScope = createMath()
    const text = (formula: string): string => math.expression(formula).toString()

    it('find their closed forms: polynomials, geometric series, powers of 1/k, products of linear factors', (): void => {
        const cases: [string, string][] = [
            ['sum(k, k, 1, n)', 'n^2/2 + n/2'],
            ['sum(k^3, k, 1, n)', 'n^4/4 + n^3/2 + n^2/4'],
            ['sum(c, k, a, b)', 'c*(-a + b + 1)'],
            ['sum(2^k, k, 0, n)', '2^(n + 1) - 1'],
            ['sum(x^k, k, 0, n)', 'piecewise(n + 1, x = 1, (-x^(n + 1) + 1)/(-x + 1))'],
            ['sum(x^k, k, 0, inf)', 'piecewise(1/(-x + 1), abs(x) < 1, sum(x^k, k, 0, inf))'],
            ['sum((1/2)^k, k, 0, inf)', '2'],
            ['sum(1/k^2, k, 1, inf)', 'pi^2/6'],
            ['sum(1/k^3, k, 1, n)', '-zeta(3, n + 1) + zeta(3)'],
            ['sum(1/k, k, 1, n)', 'EulerGamma + polygamma(0, n + 1)'],
            ['sum(k + 2^k, k, 1, n)', 'n^2/2 + n/2 + 2^(n + 1) - 2'],
            ['sum(k, k, 1, inf)', 'inf'],
            ['sum(sum(k*j, j, 1, k), k, 1, n)', 'n^4/8 + 5n^3/12 + 3n^2/8 + n/12'],
            ['product(k, k, 1, n)', 'gamma(n + 1)'],
            ['product(2k, k, 1, n)', 'gamma(n + 1)*2^n'],
            ['product(2^k, k, 1, n)', '2^(n^2/2 + n/2)'],
            ['product(1 - 1/k^2, k, 2, n)', '(n + 1)/(2n)'],
            ['product((k + 1)/(k + 3), k, 1, n)', '6/((n + 2)(n + 3))']
        ]
        for (const [given, expected] of cases) assert.strictEqual(text(given), expected, given)
    })

    it('find the sums of hypergeometric terms by Gosper\'s algorithm', (): void => {
        const cases: [string, string][] = [
            ['sum(k*2^k, k, 1, n)', '2(n - 1)*2^n + 2'],
            ['sum(k*k!, k, 1, n)', 'gamma(n + 2) - 1'],
            ['sum(1/(k*(k + 1)), k, 1, n)', 'n/(n + 1)'],
            ['sum(k/(k + 1)!, k, 1, n)', '-1/gamma(n + 2) + 1'],
            ['sum(1/(k^2 + 3k + 2), k, 0, n)', '(n + 1)/(n + 2)'],
            ['sum(k*x^k, k, 0, n)', 'piecewise(n^2/2 + n/2, x = 1, x^(n + 1)*(n*x - n - 1)/(x - 1)^2 + x/(x - 1)^2)']
        ]
        for (const [given, expected] of cases) assert.strictEqual(text(given), expected, given)
        //Not hypergeometric, or without a hypergeometric antidifference
        assert.strictEqual(text('sum(sin(k), k, 1, n)'), 'sum(sin(k), k, 1, n)')
        assert.strictEqual(text('sum(binomial(n, k), k, 0, n)'), 'sum(gamma(n + 1)/(gamma(k + 1)*gamma(-k + n + 1)), k, 0, n)')
    })

    it('add and multiply the terms between integers, the limits reversed as in SymPy', (): void => {
        assert.strictEqual(text('sum(1/k^2, k, 1, 10)'), '1968329/1270080')
        assert.strictEqual(text('sum(x^k, k, 0, 3)'), 'x^3 + x^2 + x + 1')
        assert.strictEqual(text('sum(k, k, 5, 1)'), '-9')
        assert.strictEqual(text('sum(k, k, 5, 4)'), '0')
        assert.strictEqual(text('product(k, k, 1, 5)'), '120')
        assert.strictEqual(text('product(k, k, 3, 1)'), '1/2')
        assert.strictEqual(text('product(k, k, 5, 4)'), '1')
    })

    it('keep the others as calls, with a bound variable', (): void => {
        const s = math.expression('sum(sin(k*x), k, 1, n)')
        assert.strictEqual(s.toString(), 'sum(sin(k*x), k, 1, n)')
        assert.deepStrictEqual(s.variables(), ['n', 'x'])
        assert.strictEqual(s.diff('x').toString(), 'sum(k*cos(k*x), k, 1, n)')
        assert.strictEqual(s.diff('k').toString(), '0')
        assert.strictEqual(s.substitute({n: 3}).toString(), 'sin(2x) + sin(3x) + sin(x)')
        assert.strictEqual(math.expression('sum(k, k, 1, n) + k').substitute({k: 5}).toString(), 'n^2/2 + n/2 + 5')
        assert.strictEqual(text('sum(sin(k*x), k, 1, n) + k'), 'k + sum(sin(k*x), k, 1, n)')
        assert.strictEqual(math.expression('sum(sin(k*x), k, 1, n)').toTeX(), '\\sum_{k = 1}^{n} \\sin\\left(k x\\right)')
        assert.strictEqual(math.expression('product(k^2 + 1, k, 1, n)').toTeX(), '\\prod_{k = 1}^{n} \\left(k^{2} + 1\\right)')
        assert.ok(Math.abs(math.expression('sum(sin(k), k, 1, 5000)').toNumber() - 0.27970133224749155) < 1e-12)
        assert.throws((): unknown => math.expression('sum(sin(k)/k^3, k, 1, inf)').toNumber(), MathNotSupportedException)
        assert.throws((): unknown => math.expression('sum(sin(k), k, 1, n)').compile(['n']), MathNotSupportedException)
    })

    it('refuse limits that are not integers and a variable that is not one', (): void => {
        assert.throws((): unknown => math.expression('sum(k, k, 1.5, n)'), MathArgumentException)
        assert.throws((): unknown => math.expression('sum(k, 2, 1, n)'), MathSyntaxException)
        assert.throws((): unknown => math.expression('sum(k, k, 1, k)'), MathSyntaxException)
        assert.throws((): unknown => math.expression('sum(k, k, 1)'), MathSyntaxException)
    })
})
