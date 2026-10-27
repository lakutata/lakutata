import {describe, it} from 'node:test'
import assert from 'node:assert'
import {
    createMath,
    cse,
    decimal,
    equation,
    expression,
    linalg,
    math,
    MathArgumentException,
    MathDomainException,
    MathException,
    type MathScope,
    matrix,
    ntheory,
    numeric,
    parse,
    solve,
    solveAsync,
    stats
} from '../exports/Math.js'

describe('The functions of the package', (): void => {

    it('are the ones of math, made with the default options', async (): Promise<void> => {
        assert.strictEqual(expression('(x + 1)^2').expand().toString(), 'x^2 + 2x + 1')
        assert.strictEqual(parse('x^2 = 4').toString(), 'x^2 = 4')
        assert.deepStrictEqual(equation('x^2 - 5x + 6 = 0').solve('x').map(String), ['2', '3'])
        assert.strictEqual(decimal('0.1').add('0.2').toString(), '0.3')
        //32 digits by default
        assert.strictEqual(expression('pi').toDecimal(), '3.1415926535897932384626433832795')
        assert.strictEqual(matrix([[4, 1], [2, 3]]).transpose().toString(), '[4, 2; 1, 3]')
        assert.strictEqual(solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])[0].x.toString(), '2')
        assert.strictEqual((await solveAsync(['x = 2'], ['x']))[0].x.toString(), '2')
        assert.strictEqual(cse(['sin(x + y) + x + y']).replacements.length, 1)
        assert.deepStrictEqual(linalg.solve([[4, 1], [2, 3]], [5, 5]), Float64Array.of(1, 1))
        assert.strictEqual(stats.mean([1, 2, 3]), 2)
        assert.strictEqual(ntheory.gcd(12, 18), 6n)
        assert.strictEqual(numeric.findRoot('x^2 = 2', 'x', {bracket: [0, 2]}).root, globalThis.Math.SQRT2)
        assert.strictEqual(math.linalg, linalg)
        assert.strictEqual(math.with({'f(x)': 'x^3'}).expression('f(2)').toString(), '8')
    })

    it('make others with createMath(), of definitions and settings', async (): Promise<void> => {
        const finance: MathScope = createMath({definitions: {'vat(x)': 'x * 0.2', 'rate': 0.05}, precision: 10, timeout: 50})
        assert.strictEqual(finance.expression('vat(150)').toNumber(), 30)
        assert.strictEqual(finance.expression('rate').toString(), '1/20')
        assert.strictEqual(finance.expression('pi').toDecimal(), '3.141592654')
        assert.strictEqual(finance.decimal(2).sqrt().toString(), '1.414213562')
        //Its time limit for its asynchronous operations
        await assert.rejects(finance.expression('(a + b + c + d + e + 1)^60').expandAsync(), MathException)
        //The definitions of one are not the ones of another, nor of math
        assert.throws((): unknown => expression('vat(150)').toNumber(), MathException)
        assert.strictEqual(finance.with({'twice(x)': '2x'}).expression('twice(vat(10))').toNumber(), 4)
        assert.strictEqual(finance.numeric.findRoot('vat(x) = 3', 'x', {guess: 0}).root, 15)
        for (const options of [{precision: 0}, {precision: 1.5}, {timeout: -1}, {concurrency: 0}, {definitions: {'f(x)': true}}, null]) {
            assert.throws((): unknown => createMath(options as never), MathArgumentException)
        }
    })

    it('throw exceptions that are errors, named by their classes', (): void => {
        try {
            expression('log(-1)').toDecimal()
            assert.fail('no exception')
        } catch (error) {
            assert.ok(error instanceof MathDomainException && error instanceof MathException && error instanceof Error)
            assert.strictEqual((error as MathException).name, 'MathDomainException')
            assert.strictEqual((error as MathException).errno, 'E_MATH_DOMAIN')
        }
    })
})
