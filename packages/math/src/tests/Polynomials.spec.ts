import {describe, it} from 'node:test'
import assert from 'node:assert'
import {
    createMath,
    type Expression,
    MathArgumentException,
    MathCancelledException,
    type MathScope,
    MathNotSupportedException,
    MathTimeoutException,
    poly
} from '../exports/Math.js'
import {native} from '../lib/Native.js'

describe('The polynomials', (): void => {
    const math: MathScope = createMath()
    const text = (value: Expression): string => value.toString()

    it('divide integers as Python does, the base of the algorithms of SymPy', (): void => {
        const integers = (operation: string, a: string, b: string): string => (native.run('poly', ['integers', [], [operation, a, b]]) as {text: string}).text
        assert.deepStrictEqual(['-7', '7', '-8'].map((a: string): string => integers('floorDiv', a, '2')), ['-4', '3', '-4'])
        assert.deepStrictEqual(['-7', '7', '-8'].map((a: string): string => integers('floorMod', a, '2')), ['1', '1', '0'])
        assert.deepStrictEqual(['7', '-7'].map((a: string): string => integers('floorMod', a, '-2')), ['-1', '-1'])
        assert.deepStrictEqual(['-7', '3', '2', '-3', '12'].map((a: string): string => integers('symmetricMod', a, '5')), ['-2', '-2', '2', '2', '2'])
        assert.strictEqual(integers('floorDiv', '-100000000000000000000000000001', '10'), '-10000000000000000000000000001')
    })

    it('give the greatest common divisors and the least common multiples', (): void => {
        assert.ok(text(poly.gcd('x^4 - 1', 'x^6 - 1')) === 'x^2 - 1' && text(poly.lcm('2x + 2', '4x - 4')) === '4x^2 - 4')
        //Over the integers the contents, over the rationals monic, the leading coefficients positive
        assert.ok(text(math.poly.gcd('2x + 2', '4x + 4')) === '2x + 2' && text(math.poly.gcd('x/2 + 1/2', 'x + 1')) === 'x + 1')
        assert.ok(text(math.poly.gcd('-x - 1', '-2x - 2')) === 'x + 1' && text(math.poly.gcd('-3x - 6')) === '3x + 6' && text(math.poly.gcd('x/3 + 1')) === 'x + 3')
        assert.ok(text(math.poly.gcd('0', '0')) === '0' && text(math.poly.gcd('0', '-2x + 4')) === '2x - 4' && text(math.poly.gcd('4', '6x + 9')) === '1')
        assert.ok(text(math.poly.gcd('1/2', '1/3')) === '1/6' && text(math.poly.lcm('2/3', '3/4')) === '6' && text(math.poly.gcd(12, 18n, '30')) === '6')
        //Several variables, generators that are not symbols, deflated exponents, large coefficients
        assert.strictEqual(text(math.poly.gcd('(x - 1)*(y - 2)*(z + 3)', '(x - 1)*(z + 3)*(x + y + z)')), 'x*z + 3x - z - 3')
        assert.ok(text(math.poly.gcd('exp(2x) - 1', 'exp(x) - 1')) === 'e^x - 1' && text(math.poly.gcd('sin(x)^2 - 1', 'sin(x) - 1')) === 'sin(x) - 1')
        assert.ok(text(math.poly.gcd('x^(3/2) - sqrt(x)', 'sqrt(x)')) === 'sqrt(x)' && text(math.poly.gcd('x - sqrt(x)', 'x - 1')) === '1')
        assert.ok(text(math.poly.gcd('x^100 - 1', 'x^60 - 1')) === 'x^20 - 1' && text(math.poly.gcd('x^6 - y^6', 'x^4 - y^4', 'x^3 - y^3')) === 'x - y')
        assert.strictEqual(text(math.poly.gcd('(2^70 x + 1)*(x + 3)', '(2^70 x + 1)*(x - 5)')), '1180591620717411303424x + 1')
        assert.ok(text(math.poly.lcm('x^2 - y^2', 'x^2 + 2x*y + y^2')) === 'x^3 + x^2*y - x*y^2 - y^3' && text(math.poly.lcm('0', 'x')) === '0')
        //The definitions of the scope are in the formulas
        assert.strictEqual(text(math.with({'g(t)': 't^2'}).poly.gcd('g(y) - 1', 'y - 1')), 'y - 1')
    })

    it('give the resultants and the discriminants', (): void => {
        assert.ok(text(poly.resultant('x^2 + y', 'x - y', 'x')) === 'y^2 + y' && text(poly.discriminant('a*x^2 + b*x + c', 'x')) === '-4a*c + b^2')
        //res(g, f) = (-1)^(mn) res(f, g)
        assert.ok(text(math.poly.resultant('x', 'x^3 + 1', 'x')) === '1' && text(math.poly.resultant('x^3 + 1', 'x', 'x')) === '-1')
        assert.ok(text(math.poly.resultant('x*y - 1', 'x^3 + y', 'x')) === 'y^4 + 1' && text(math.poly.resultant('x^2 + 1', 'x^2 + 1', 'x')) === '0')
        assert.ok(text(math.poly.resultant('x^2/2 + 1', 'x - 1/3', 'x')) === '19/18' && text(math.poly.resultant('x + y', 'y^2', 'z')) === '1')
        assert.ok(text(math.poly.discriminant('x^3 + p*x + q', 'x')) === '-4p^3 - 27q^2' && text(math.poly.discriminant('5', 'x')) === '0')
        assert.ok(text(math.poly.discriminant('x^2/2 + x', 'x')) === '1' && text(math.poly.discriminant('(x - 1)^2*(x + 2)', 'x')) === '0')
    })

    it('refuse what is not a polynomial, and arguments that are not valid', (): void => {
        assert.throws((): unknown => math.poly.gcd('x', '1/x + 1'), (error: unknown): boolean => error instanceof MathNotSupportedException && /negative power/.test(error.message))
        assert.throws((): unknown => math.poly.gcd('x^2 + 2i*x - 1', 'x + i'), (error: unknown): boolean => error instanceof MathNotSupportedException && /complex/.test(error.message))
        assert.throws((): unknown => math.poly.gcd('x^2000*y^2000 + 1', 'x'), (error: unknown): boolean => error instanceof MathNotSupportedException && /x\^2000, y\^2000/.test(error.message))
        for (const huge of ['x^(10^30) - 1', 'x^(10^30/7) - 1', 'exp(10^30 x) - 1']) {
            assert.throws((): unknown => math.poly.gcd(huge, 'x - 1'), (error: unknown): boolean => error instanceof MathNotSupportedException && /too high/.test(error.message), huge)
        }
        assert.throws((): unknown => math.poly.gcd(), MathArgumentException)
        assert.throws((): unknown => math.poly.resultant('x', 'y', 'sin'), MathArgumentException)
        assert.throws((): unknown => math.poly.discriminant('x^2', '2x'), MathArgumentException)
    })

    it('run in the threads of the addon, with a time limit and a cancellation', async (): Promise<void> => {
        assert.strictEqual(text(await math.poly.gcdAsync(['x^2 - 1', 'x - 1'])), 'x - 1')
        assert.strictEqual(text(await math.poly.lcmAsync(['x', 'x + 1'])), 'x^2 + x')
        assert.strictEqual(text(await math.poly.resultantAsync('x^2 + y', 'x - y', 'x')), 'y^2 + y')
        assert.strictEqual(text(await math.poly.discriminantAsync('x^2 + b*x + c', 'x')), 'b^2 - 4c')
        await assert.rejects(math.poly.gcdAsync('x' as never), MathArgumentException)
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.poly.gcdAsync(['x^2 - 1', 'x - 1'], {signal: controller.signal}), MathCancelledException)
        await assert.rejects(math.poly.discriminantAsync('(x + y + z + 1)^30', 'x', {timeout: 5}), MathTimeoutException)
    })
})
