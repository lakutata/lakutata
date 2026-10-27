import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathDomainException, MathNotSupportedException, type MathScope, MathSyntaxException} from '../exports/Math.js'

describe('The piecewise expressions', (): void => {
    const math: MathScope = createMath()
    const text = (formula: string): string => math.expression(formula).toString()

    it('read their cases and conditions, and print them as they are read', (): void => {
        const cases: [string, string][] = [
            ['piecewise(x^2, x < 0, x)', 'piecewise(x^2, x < 0, x)'],
            ['piecewise(x^2, x > 0)', 'piecewise(x^2, x > 0)'],
            ['piecewise(1, 0 <= x < 1, 0)', 'piecewise(1, 0 <= x < 1, 0)'],
            ['piecewise(1, x > 0 and x < 1)', 'piecewise(1, 0 < x < 1)'],
            ['piecewise(1, not (x < 0 or x > 1), 2)', 'piecewise(1, 0 <= x <= 1, 2)'],
            ['piecewise(1, not x = 0, 0)', 'piecewise(1, x != 0, 0)'],
            ['piecewise(1, (x + 1) < 2, 0)', 'piecewise(1, x + 1 < 2, 0)'],
            ['piecewise(1, x >= 0 and y < 0, 2)', 'piecewise(1, x >= 0 and y < 0, 2)'],
            ['2piecewise(x, x > 0, -x) + 1', '2piecewise(x, x > 0, -x) + 1'],
            ['piecewise(1, x < 0, 1)', '1'],
            ['piecewise(2, x < 0, 1, x > 2, 1)', 'piecewise(2, x < 0, 1)'],
            ['step(x)', 'piecewise(0, x < 0, 1/2, x = 0, 1)'],
            ['tri(x)', 'piecewise(-abs(x) + 1, abs(x) < 1, 0)']
        ]
        for (const [given, expected] of cases) {
            assert.strictEqual(text(given), expected, given)
            assert.strictEqual(text(expected), expected, `${expected} read again`)
        }
        const both: string = text('piecewise(1, (x < 0 or x > 1) and y > 0, 2, x > 5, 3)')
        assert.ok(math.expression(both).equals('piecewise(1, (x < 0 or x > 1) and y > 0, 2, x > 5, 3)'), both)
        assert.ok(/\(x > 1 or x < 0\)|\(x < 0 or x > 1\)/.test(both), both)
    })

    it('refuse what is not a piecewise expression', (): void => {
        assert.throws((): unknown => math.expression('piecewise(x)'), MathSyntaxException)
        assert.throws((): unknown => math.expression('piecewise(x, y)'), /compares values/)
        assert.throws((): unknown => math.expression('and + 1'), /word of the conditions/)
        assert.throws((): unknown => math.parse('x != 1'), MathNotSupportedException)
        assert.throws((): unknown => math.expression('piecewise(1, i < 0, 2)'), MathDomainException)
        assert.throws((): unknown => math.expression('piecewise(x^2, x < 0, x)').substitute({x: 'i'}), MathDomainException)
    })

    it('take the case that holds, also at the ends of the cases, nan where none does', (): void => {
        const value = (formula: string, x: string | number): number => math.expression(formula).substitute({x}).toNumber()
        assert.strictEqual(value('piecewise(x^2, x < 0, x)', -2), 4)
        assert.strictEqual(value('piecewise(x^2, x < 0, x)', 0), 0)
        assert.strictEqual(value('piecewise(x^2, x < 0, x)', 3), 3)
        assert.strictEqual(value('step(x)', 0), 0.5)
        assert.strictEqual(value('step(x)', '-1/10^30'), 0)
        assert.strictEqual(value('rect(x)', '1/2'), 0.5)
        assert.strictEqual(value('rect(x)', '-1/2'), 0.5)
        assert.strictEqual(value('tri(x)', 1), 0)
        assert.strictEqual(value('tri(x)', '1/4'), 0.75)
        assert.strictEqual(value('piecewise(1, 0 <= x < 1, 0)', 1), 0)
        //The conditions of constants are decided exactly
        assert.strictEqual(text('piecewise(1, sqrt(2) < 3/2, 2)'), '1')
        assert.strictEqual(text('step(sqrt(2) - 1)'), '1')
        assert.strictEqual(value('step(x)', 'sqrt(2) - 1.4142135623730950488'), 1)
        assert.strictEqual(math.expression('piecewise(x^2, x > 0)').substitute({x: -1}).toString(), 'nan')
        assert.ok(Number.isNaN(math.expression('piecewise(x^2, x > 0)').compile(['x'])(-1)))
    })

    it('derive, compile, write in LaTeX, JavaScript and C, and integrate in pieces', (): void => {
        assert.strictEqual(math.expression('piecewise(x^2, x < 0, x)').diff('x').toString(), 'piecewise(2x, x < 0, 1)')
        assert.strictEqual(math.expression('step(x)').diff('x').toString(), '0')
        assert.strictEqual(math.expression('piecewise(x, x > 0)').diff('x', 2).toString(), 'piecewise(0, x > 0)')
        const f = math.expression('piecewise(x^2, x < 0, x)').compile(['x'])
        assert.deepStrictEqual([f(-2), f(0), f(3)], [4, 0, 3])
        assert.strictEqual(math.expression('piecewise(x^2, x < 0, x)').toTeX(), '\\begin{cases} x^{2} & \\text{for}\\: x < 0 \\\\ x & \\text{otherwise} \\end{cases}')
        assert.strictEqual(math.expression('piecewise(1, 0 <= x < 1, 0)').toTeX(), '\\begin{cases} 1 & \\text{for}\\: 0 \\leq x < 1 \\\\ 0 & \\text{otherwise} \\end{cases}')
        assert.strictEqual(math.expression('piecewise(x^2, x < 0, 1, x = 0 or x > 5, 2)').toJavaScript(), '(x < 0 ? Math.pow(x, 2) : (0 === x) || (5 < x) ? 1 : 2)')
        assert.strictEqual(math.expression('piecewise(x^2, x > 0)').toC(), '(0.0 < x ? pow(x, 2.0) : NAN)')
        assert.strictEqual(math.numeric.integrate('step(x - 1)', 'x', [0, 3]).value, 2)
        assert.ok(Math.abs(math.numeric.integrate('rect(x)', 'x', [-2, 2]).value - 1) < 1e-12)
        assert.ok(Math.abs(math.numeric.integrate('tri(x)', 'x', [-2, 2]).value - 1) < 1e-12)
    })
})
