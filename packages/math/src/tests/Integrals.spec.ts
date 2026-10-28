import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathArgumentException, MathCancelledException, MathDomainException, MathNotSupportedException, type MathScope} from '../exports/Math.js'

describe('The integrals', (): void => {
    const math: MathScope = createMath()
    const antiderivative = (formula: string): string => math.expression(formula).integrate('x').toString()
    const definite = (formula: string, from: string, to: string): string => math.expression(formula).integrate('x', from, to).toString()
    const check = (cases: [string, string][]): void => {
        for (const [formula, expected] of cases) assert.strictEqual(antiderivative(formula), expected, formula)
    }

    it('integrate polynomials, powers and fractions of polynomials by their partial fractions', (): void => {
        check([
            ['3x^2 + 2x + 1', 'x^3 + x^2 + x'],
            ['1/x', 'ln(x)'],
            ['x^(1/2)', '2x^(3/2)/3'],
            ['1/(x^2 + 1)', 'atan(x)'],
            ['1/(x^2 + 2x + 5)', 'atan((x + 1)/2)/2'],
            ['(x^3 + 1)/(x^2 - 1)', 'x^2/2 + ln(x - 1)'],
            ['x/(x^2 + 1)^3', '-1/(4(x^2 + 1)^2)']
        ])
        assert.strictEqual(antiderivative('x^n'), 'piecewise(ln(x), n = -1, x^(n + 1)/(n + 1))')
    })

    it('integrate by the table, substitution, parts and the powers of sines and cosines', (): void => {
        check([
            ['x*e^x', 'e^x*(x - 1)'],
            ['ln(x)/x', 'ln(x)^2/2'],
            ['1/(x*ln(x))', 'ln(ln(x))'],
            ['e^x/(1 + e^x)', 'ln(e^x + 1)'],
            ['x*sin(x)', '-x*cos(x) + sin(x)'],
            ['cos(x)^3', '-sin(x)^3/3 + sin(x)'],
            ['sin(x)^2', 'x/2 - sin(2x)/4'],
            ['sec(x)^2', 'tan(x)'],
            ['1/(1 + cos(x))', 'tan(x/2)'],
            ['1/sqrt(1 - x^2)', 'asin(x)'],
            ['2x*e^(x^2)', 'e^(x^2)'],
            ['e^(-x^2)', 'sqrt(pi)*erf(x)/2'],
            ['cosh(x)^2', 'x/2 + sinh(2x)/4'],
            ['x^2/sqrt(x^2 + 1)', '(-asinh(x) + x*sqrt(x^2 + 1))/2'],
            ['(x + 1)/sqrt(x^2 + 2x + 5)', 'sqrt(x^2 + 2x + 5)'],
            ['(x^2 + 1)^(3/2)', '(2x*(x^2 + 1)^(3/2) + 3asinh(x) + 3x*sqrt(x^2 + 1))/8'],
            ['x*e^x*sin(x)', 'e^x*(-x*cos(x)/2 + cos(x)/2 + x*sin(x)/2)']
        ])
    })

    it('give definite integrals by the limits at the ends, split at the poles and the jumps inside', (): void => {
        assert.strictEqual(definite('x^2', '0', '3'), '9')
        assert.strictEqual(definite('e^(-x)', '0', 'inf'), '1')
        assert.strictEqual(definite('1/(x^2 + 1)', '-inf', 'inf'), 'pi')
        assert.strictEqual(definite('ln(x)', '0', '1'), '-1')
        assert.strictEqual(definite('x', 'a', 'b'), '-a^2/2 + b^2/2')
        assert.strictEqual(definite('x^2', '3', '0'), '-9')
        assert.strictEqual(definite('x^2', '2', '2'), '0')
        //tan(x/2) of the half angle jumps at pi
        assert.strictEqual(definite('1/(2 + cos(x))', '0', '2pi'), '2pi*sqrt(3)/3')
        assert.strictEqual(definite('1/x', '0', '1'), 'inf')
        assert.strictEqual(definite('1/x^2', '-1', '1'), 'inf')
        assert.throws((): string => definite('1/x', '-1', '1'), MathDomainException)
    })

    it('give the special functions of integrals: Si, Ci, Shi, Chi, Ei, li, fresnelS, fresnelC', (): void => {
        check([
            ['sin(x)/x', 'Si(x)'],
            ['e^x/x', 'Ei(x)'],
            ['1/ln(x)', 'li(x)'],
            ['sinh(2x)/x', 'Shi(2x)'],
            ['cos(x)/(2x)', 'Ci(x)/2']
        ])
        assert.strictEqual(definite('sin(x)/x', '0', 'inf'), 'pi/2')
        assert.strictEqual(definite('sin(x^2)', '0', 'inf'), 'sqrt(pi)*sqrt(2)/4')
        //Their values in doubles (those of mpmath), their derivatives, limits and series
        const values: [string, number][] = [['Si(10)', 1.658347594218874], ['Ci(1)', 0.337403922900968], ['Chi(2)', 2.452666922646915], ['Ei(-1)', -0.219383934395520], ['li(10)', 6.165599504787298], ['fresnelS(3)', 0.496312998967375], ['fresnelC(1)', 0.779893400376823]]
        for (const [formula, value] of values) assert.ok(globalThis.Math.abs(math.expression(formula).toNumber() - value) <= 1e-14 * globalThis.Math.abs(value), formula)
        assert.deepStrictEqual(math.expression('Ci(-1)').toComplex(), {re: 0.33740392290096816, im: globalThis.Math.PI})
        assert.strictEqual(math.expression('Si(-x)').toString(), '-Si(x)')
        assert.strictEqual(math.expression('fresnelS(2x)').diff('x').toString(), '2sin(2pi*x^2)')
        assert.strictEqual(math.expression('Si(x)').limit('x', 'inf').toString(), 'pi/2')
        assert.strictEqual(math.expression('Si(x)').series('x', 0, 6).toString(), 'x^5/600 - x^3/18 + x')
        assert.throws((): string => math.expression('Ci(x)').series('x', 0, 4).toString(), MathNotSupportedException)
        //Their decimals: the power series (the digits a sum cancels computed more), the asymptotic series for large
        //arguments; the values of exact series of rationals at 45 digits (Python's fractions)
        const decimals: [string, string][] = [
            ['Si(1)', '0.946083070367183014941353313823179657812337955'],
            ['Ci(1)', '0.337403922900968134662646203889150769997578033'],
            ['Shi(1)', '1.05725087537572851457184235489587795902405394'],
            ['Chi(1)', '0.837866940980208240894678579435756309993006644'],
            ['li(2)', '1.04516378011749278484458888919461313652261558'],
            ['fresnelS(1)', '0.438259147390354766076756696625152637493786572']
        ]
        for (const [formula, value] of decimals) assert.strictEqual(math.expression(formula).toDecimal(45), value, formula)
        //Large arguments (the asymptotic series) as in doubles, and their poles and complex values refused
        for (const formula of ['Si(1000)', 'Ci(100)', 'Ei(-200)', 'fresnelC(10)', 'Chi(100)']) {
            const value: number = math.expression(formula).toNumber()
            assert.ok(globalThis.Math.abs(Number(math.expression(formula).toDecimal(20)) - value) <= 1e-14 * globalThis.Math.abs(value), formula)
        }
        assert.throws((): string => math.expression('Ei(0)').toDecimal(), MathDomainException)
        assert.throws((): string => math.expression('Ci(-1)').toDecimal(), MathNotSupportedException)
    })

    it('refuse what it does not find, and wrong arguments', async (): Promise<void> => {
        for (const formula of ['sin(x)/(x + 1)', 'e^(x^2)', '1/(x^5 - x + 1)']) assert.throws((): string => antiderivative(formula), MathNotSupportedException, formula)
        assert.throws((): string => math.expression('x').integrate('x', 0).toString(), MathArgumentException)
        assert.throws((): string => definite('x', '0', 'x'), MathArgumentException)
        assert.strictEqual((await math.expression('x*e^x').integrateAsync('x')).toString(), 'e^x*(x - 1)')
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.expression('x').integrateAsync('x', undefined, undefined, {signal: controller.signal}), MathCancelledException)
    })
})
