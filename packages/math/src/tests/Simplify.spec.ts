import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathCancelledException, type MathScope} from '../exports/Math.js'

describe('The simplification', (): void => {
    const math: MathScope = createMath()
    const simplified = (formula: string): string => math.expression(formula).simplify().toString()
    const check = (cases: [string, string][]): void => {
        for (const [formula, expected] of cases) assert.strictEqual(simplified(formula), expected, formula)
    }

    it('cancel fractions and expand where it is shorter, and keep the expression where nothing is', (): void => {
        check([
            ['(x^2 - 1)/(x - 1)', 'x + 1'],
            ['x/(x*y + x)', '1/(y + 1)'],
            ['(x^2 - 4)/(x^2 + 4x + 4)', '(x - 2)/(x + 2)'],
            ['(x + 1)^2 - x^2 - 2x', '1'],
            ['1/x + 1/y', '1/x + 1/y'],
            ['((x^2 + 1)^5 - 1)/x^2', '((x^2 + 1)^5 - 1)/x^2'],
            ['x + y', 'x + y']
        ])
    })

    it('reduce sines and cosines by sin^2 + cos^2 = 1, with double angles, half angles and tangents', (): void => {
        check([
            ['sin(x)^2 + cos(x)^2', '1'],
            ['1 - cos(x)^2', 'sin(x)^2'],
            ['2sin(x)cos(x)', 'sin(2x)'],
            ['cos(x)^2 - sin(x)^2', 'cos(2x)'],
            ['sin(2x)/sin(x)', '2cos(x)'],
            ['(1 - cos(2x))/2', 'sin(x)^2'],
            ['sin(x)^4 - cos(x)^4', '-cos(2x)'],
            ['sin(x)/cos(x)', 'tan(x)'],
            ['tan(x)*cos(x)', 'sin(x)'],
            ['1/cos(x)^2 - tan(x)^2', '1'],
            ['tan(x/2)*(1 + cos(x))', 'sin(x)'],
            ['sin(x)^2/(1 - cos(x))', 'cos(x) + 1'],
            ['cos(x) - cos(x)^3', 'cos(x)*sin(x)^2'],
            ['sin(x + y) - sin(x)cos(y)', 'cos(x)*sin(y)'],
            ['sin(x)^2 + cos(x)^2 + sin(y)^2 + cos(y)^2', '2']
        ])
    })

    it('reduce the hyperbolic functions by cosh^2 - sinh^2 = 1 and exchange them with exponentials', (): void => {
        check([
            ['cosh(x)^2 - sinh(x)^2', '1'],
            ['sinh(2x)/cosh(x)', '2sinh(x)'],
            ['cosh(x) + sinh(x)', 'e^x'],
            ['(exp(x) + exp(-x))/2', 'cosh(x)'],
            ['(exp(2x) - 1)/(exp(x) - 1)', 'e^x + 1']
        ])
    })

    it('take nested square roots of numbers apart, take them out of denominators, combine logarithms of numbers', (): void => {
        check([
            ['sqrt(3 + 2sqrt(2))', 'sqrt(2) + 1'],
            ['sqrt(5 - 2sqrt(6))', '-sqrt(2) + sqrt(3)'],
            ['1/(1 + sqrt(2))', 'sqrt(2) - 1'],
            ['1/(sqrt(3) - sqrt(2))', 'sqrt(2) + sqrt(3)'],
            ['(sqrt(6) + sqrt(2))/sqrt(2)', 'sqrt(3) + 1'],
            ['log(2) + log(3)', 'ln(6)'],
            ['log(8) - log(2)', 'ln(4)'],
            ['2log(3)', 'ln(9)']
        ])
    })

    it('simplify the arguments of functions and the values of piecewise expressions, nothing that needs signs', (): void => {
        check([
            ['exp(sin(x)^2 + cos(x)^2)', 'e'],
            ['sqrt(sin(x)^2 + cos(x)^2 + 3)', '2'],
            ['piecewise(sin(x)^2 + cos(x)^2, x < 0, x)', 'piecewise(1, x < 0, x)'],
            ['sqrt(x^2)', 'sqrt(x^2)'],
            ['ln(x*y)', 'ln(x*y)'],
            ['sum(k^2 + k, k, 1, n)', 'n*(n + 1)(n + 2)/3']
        ])
        assert.strictEqual(math.expressionMatrix([['sin(x)^2 + cos(x)^2', '(x^2 - 1)/(x - 1)']]).simplify().toString(), '[1, x + 1]')
    })

    it('give the same form when simplified again, in the threads of the addon too', async (): Promise<void> => {
        for (const formula of ['sin(x)^4 - cos(x)^4', '(exp(x) + exp(-x))/2', 'x*sin(x)^2 + x*cos(x)^2 + 1/(1 + sqrt(2))']) {
            const once: string = simplified(formula)
            assert.strictEqual(simplified(once), once, formula)
            assert.strictEqual((await math.expression(formula).simplifyAsync()).toString(), once, formula)
        }
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.expression('sin(x)^2 + cos(x)^2').simplifyAsync({signal: controller.signal}), MathCancelledException)
    })
})
