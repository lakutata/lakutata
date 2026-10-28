import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathArgumentException, MathDomainException, MathNotSupportedException, type MathScope} from '../exports/Math.js'

describe('The limits', (): void => {
    const math: MathScope = createMath()
    const limit = (formula: string, point: string, direction?: '+' | '-' | 'both'): string => math.expression(formula).limit('x', point, direction ? {direction: direction} : {}).toString()

    it('find the limits of 0/0, inf/inf, 0 inf and 1^inf by Gruntz\'s algorithm', (): void => {
        const cases: [string, string, string][] = [
            ['sin(x)/x', '0', '1'],
            ['(1 - cos(x))/x^2', '0', '1/2'],
            ['(sin(x) - x)/x^3', '0', '-1/6'],
            ['x/(exp(x) - 1)', '0', '1'],
            ['(x^3 + 2x)/(5x^3 - 1)', 'inf', '1/5'],
            ['(1 + 1/x)^x', 'inf', 'e'],
            ['(1 + a/x)^x', 'inf', 'e^a'],
            ['(exp(a*x) - 1)/x', '0', 'a'],
            ['(x^2 - a^2)/(x - a)', 'a', '2a'],
            ['(1 - x)^(1/x)', '0', '1/e'],
            ['x^5*exp(-x)', 'inf', '0'],
            ['log(x)/sqrt(x)', 'inf', '0'],
            ['log(log(x))/log(x)', 'inf', '0'],
            ['exp(exp(x))/exp(x)', 'inf', 'inf'],
            ['exp(x)/(exp(x) + 1)', 'inf', '1'],
            ['sqrt(x^2 + 1) - x', 'inf', '0'],
            ['x*(exp(1/x) - 1)', 'inf', '1'],
            ['x^(1/x)', 'inf', '1'],
            ['(2^x + 3^x)^(1/x)', 'inf', '3'],
            ['2^x/3^x', 'inf', '0'],
            ['x^2 - x^3', 'inf', '-inf'],
            ['exp(x)', '-inf', '0']
        ]
        for (const [formula, point, expected] of cases) assert.strictEqual(limit(formula, point), expected, `${formula} at ${point}`)
    })

    it('take a side of a point, and both by default: different sides have no limit', (): void => {
        assert.strictEqual(limit('x^x', '0', '+'), '1')
        assert.strictEqual(limit('x*log(x)', '0', '+'), '0')
        assert.strictEqual(limit('1/x', '0', '+'), 'inf')
        assert.strictEqual(limit('1/x', '0', '-'), '-inf')
        assert.strictEqual(limit('exp(1/x)', '0', '-'), '0')
        assert.strictEqual(limit('tan(x)', 'pi/2', '-'), 'inf')
        assert.strictEqual(limit('1/(x - a)', 'a', '+'), 'inf')
        assert.strictEqual(limit('(x^2 - 1)/(x - 1)', '1'), '2')
        assert.throws((): string => limit('1/x', '0'), (error: Error): boolean => error instanceof MathDomainException && /-inf from below, inf from above/.test(error.message))
        assert.throws((): string => limit('abs(x)/x', '0'), MathDomainException)
    })

    it('decide abs, sign, max, min, floor and piecewise by the side, and rewrite the hyperbolic functions', (): void => {
        assert.strictEqual(limit('floor(x)', '2', '+'), '2')
        assert.strictEqual(limit('floor(x)', '2', '-'), '1')
        assert.throws((): string => limit('floor(x)', '2'), MathDomainException)
        assert.strictEqual(limit('step(x)', '0', '+'), '1')
        assert.throws((): string => limit('step(x)', '0'), MathDomainException)
        assert.strictEqual(limit('max(x, x^2)', 'inf'), 'inf')
        assert.strictEqual(limit('min(x, 1)', 'inf'), '1')
        assert.strictEqual(limit('tanh(x)', '-inf'), '-1')
        assert.strictEqual(limit('sinh(x)/exp(x)', 'inf'), '1/2')
        assert.strictEqual(limit('asinh(x) - log(x)', 'inf'), 'ln(2)')
        assert.strictEqual(limit('atanh(x)', '1', '-'), 'inf')
        assert.strictEqual(limit('x*(atan(x) - pi/2)', 'inf'), '-1')
    })

    it('combine the limits of the parts where the algorithm takes no series: oscillations, functions at infinity', (): void => {
        assert.strictEqual(limit('sin(x)/x', 'inf'), '0')
        assert.strictEqual(limit('x + sin(x)', 'inf'), 'inf')
        assert.strictEqual(limit('exp(sin(x)/x)', 'inf'), '1')
        assert.strictEqual(limit('erf(x)', '-inf'), '-1')
        assert.strictEqual(limit('gamma(x)', 'inf'), 'inf')
        assert.strictEqual(limit('zeta(x)', 'inf'), '1')
        for (const [formula, point] of [['sin(x)', 'inf'], ['sin(1/x)', '0'], ['x*sin(x)', 'inf']]) {
            assert.throws((): string => limit(formula, point), (error: Error): boolean => error instanceof MathDomainException && /oscillates/.test(error.message), formula)
        }
    })

    it('take the special functions of integrals by their series at a point and the asymptotic series of Ei', (): void => {
        assert.strictEqual(limit('Si(x)/x', '0'), '1')
        assert.strictEqual(limit('(Si(x) - sin(x))/x^3', '0'), '1/9')
        assert.strictEqual(limit('(fresnelC(x) - x)/x^5', '0'), '-pi^2/40')
        assert.strictEqual(limit('x*Si(1/x)', 'inf'), '1')
        assert.strictEqual(limit('Ci(x) - ln(x)', '0', '+'), 'EulerGamma')
        assert.strictEqual(limit('Ei(x) - ln(-x)', '0', '-'), 'EulerGamma')
        assert.strictEqual(limit('x^2*(Chi(1/x) + ln(x) - EulerGamma)', 'inf'), '1/4')
        assert.strictEqual(limit('li(x) - ln(abs(ln(x)))', '1', '+'), 'EulerGamma')
        assert.strictEqual(limit('(Ci(x) - Ci(2))/(x - 2)', '2'), 'cos(2)/2')
        assert.strictEqual(limit('(x*e^(-x)*Ei(x) - 1)*x', 'inf'), '1')
        assert.strictEqual(limit('x*e^(-x)*Shi(x)', 'inf'), '1/2')
        assert.strictEqual(limit('li(x)*ln(x)/x', 'inf'), '1')
        assert.strictEqual(limit('li(x)*ln(x)/x', '0', '+'), '1')
        //A value of one of them in a limit (SymEngine's series of it crashed)
        assert.strictEqual(limit('x*(e^(Si(1)/x) - 1)', 'inf'), 'Si(1)')
    })

    it('refuse limits it does not find, and wrong arguments', async (): Promise<void> => {
        assert.throws((): string => limit('exp(a*x)', 'inf'), (error: Error): boolean => error instanceof MathNotSupportedException && /sign of a/.test(error.message))
        assert.throws((): string => limit('gamma(x + 1)/x', 'inf'), MathNotSupportedException)
        assert.throws((): string => limit('x', 'x'), MathArgumentException)
        assert.throws((): string => math.expression('x').limit('x', 0, {direction: 'up' as '+'}).toString(), MathArgumentException)
        assert.throws((): string => limit('1/x', 'nan'), MathArgumentException)
        assert.strictEqual((await math.expression('sin(x)/x').limitAsync('x', 0)).toString(), '1')
    })
})
