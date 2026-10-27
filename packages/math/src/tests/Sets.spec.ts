import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, type Inequality, MathCancelledException, MathNotSupportedException, type MathScope, MathSet, type Solutions} from '../exports/Math.js'

describe('The sets and the inequalities', (): void => {
    const math: MathScope = createMath()
    const solve = (text: string): Solutions => (math.parse(text) as Inequality).solve('x')

    it('solve the inequalities of fractions of polynomials in the real numbers', (): void => {
        const cases: [string, string][] = [
            ['x^2 < 4', '(-2, 2)'],
            ['x^2 >= 4', '(-inf, -2] ∪ [2, inf)'],
            ['(x^2 - 1)/(x - 1) >= 0', '[-1, 1) ∪ (1, inf)'],
            ['x^2 > 0', '(-inf, 0) ∪ (0, inf)'],
            ['x^2*(x + 1) <= 0', '(-inf, -1] ∪ {0}'],
            ['(x - 1)^2*(x - 2) >= 0', '{1} ∪ [2, inf)'],
            ['1/x > 0', '(0, inf)'],
            ['1/(1 + 1/x) > 0', '(-inf, -1) ∪ (0, inf)'],
            ['x^2 < 2', '(-sqrt(2), sqrt(2))'],
            ['x^5 <= 2', '(-inf, 2^(1/5)]'],
            ['x^6 > 3', '(-inf, -3^(1/6)) ∪ (3^(1/6), inf)'],
            ['(x + 1)/(x^2 - 4) <= 0', '(-inf, -2) ∪ [-1, 2)'],
            ['x^2 + 1 > 0', '(-inf, inf)'],
            ['x + 1 > x', '(-inf, inf)'],
            ['x < x', '']
        ]
        for (const [text, expected] of cases) assert.strictEqual(solve(text).toString(), expected, text)
        const point: Solutions = solve('x^2 <= 0')
        assert.strictEqual(point.kind, 'finite')
        assert.deepStrictEqual(point.map(String), ['0'])
        assert.strictEqual(solve('x^2 + 1 < 0').kind, 'empty')
        assert.strictEqual(solve('x^2 + 1 < 0').set.toString(), '{}')
        //The isolated points are the values of the solutions
        assert.deepStrictEqual(solve('x^2*(x + 1) <= 0').map(String), ['0'])
        //Three real roots of a cubic, written by Cardano's formula with complex parts
        const cubic: Solutions = solve('x^3 - 3x + 1 > 0')
        assert.strictEqual(cubic.set.intervals.length, 2)
        assert.ok(cubic.set.contains(0) && cubic.set.contains(2) && cubic.set.contains(1) === false && cubic.set.contains(-2) === false)
    })

    it('refuse the inequalities it does not solve exactly', (): void => {
        for (const text of ['sqrt(2)*x < 1', 'a*x < 1', 'sin(x) < 1/2', 'x^5 - x - 1 > 0']) {
            assert.throws((): unknown => solve(text), MathNotSupportedException, text)
        }
        assert.throws((): unknown => solve('x^5 - x - 1 > 0'), /numeric\.polynomialRoots/)
    })

    it('solve in the threads of the addon', async (): Promise<void> => {
        assert.strictEqual((await (math.parse('x^2 < 9') as Inequality).solveAsync('x')).toString(), '(-3, 3)')
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects((math.parse('x^2 < 9') as Inequality).solveAsync('x', {signal: controller.signal}), MathCancelledException)
    })

    it('give the solutions of an equation as a set, with the roots of binomials', (): void => {
        assert.strictEqual(math.expression('x^4 - 1').solve('x').set.toString(), '{-1, 1, -i, i}')
        assert.strictEqual(math.equation('x = x').solve('x').set.kind, 'all')
        assert.strictEqual(math.expression('sin(x)').solve('x').set.kind, 'other')
        const fifth: Solutions = math.expression('x^5 - 2').solve('x')
        assert.strictEqual(fifth.length, 5)
        assert.strictEqual(fifth[0]!.toString(), '2^(1/5)')
        assert.deepStrictEqual(math.expression('x^5 + 2').solve('x', {domain: 'real'}).map(String), ['-2^(1/5)'])
        assert.deepStrictEqual(math.expression('x^6 - 3').solve('x', {domain: 'real'}).map(String), ['-3^(1/6)', '3^(1/6)'])
    })

    it('make sets of intervals and values, with their operations', (): void => {
        const set: MathSet = math.interval(0, 2, {endOpen: true}).union(math.finiteSet([3]))
        assert.ok(set instanceof MathSet)
        assert.strictEqual(set.toString(), '[0, 2) ∪ {3}')
        assert.strictEqual(set.toTeX(), '\\left[0, 2\\right) \\cup \\left\\{3\\right\\}')
        assert.strictEqual(set.complement().toString(), '(-inf, 0) ∪ [2, 3) ∪ (3, inf)')
        assert.strictEqual(set.contains('sqrt(2)'), true)
        assert.strictEqual(set.contains(2), false)
        assert.strictEqual(set.contains('x'), undefined)
        const root: MathSet = math.interval('-sqrt(2)', 'sqrt(2)', {startOpen: true})
        assert.strictEqual(root.toString(), '(-sqrt(2), sqrt(2)]')
        assert.strictEqual(root.intersect(math.interval(0, 'inf')).toString(), '[0, sqrt(2)]')
        assert.strictEqual(math.interval(0, 1, {startOpen: true, endOpen: true}).union(math.finiteSet([1])).union(math.interval(1, 2, {startOpen: true, endOpen: true})).toString(), '(0, 2)')
        assert.strictEqual(math.interval(0, 1, {endOpen: true}).union(math.interval(1, 2)).toString(), '[0, 2]')
        assert.strictEqual(math.interval(0, 5).difference(math.interval(1, 2, {startOpen: true})).toString(), '[0, 1] ∪ (2, 5]')
        assert.strictEqual(math.interval(0, 5).difference(math.finiteSet([1, 6])).toString(), '[0, 1) ∪ (1, 5]')
        assert.strictEqual(math.interval(-1, 1).difference(math.interval(0, 2, {startOpen: true})).toString(), '[-1, 0]')
        assert.strictEqual(math.interval(0, 1).difference(math.interval(-1, 0, {endOpen: true}).union(math.interval(0, 2, {startOpen: true}))).toString(), '{0}')
        assert.strictEqual(math.finiteSet([3, 1, 'sqrt(2)', 1]).toString(), '{1, sqrt(2), 3}')
        assert.strictEqual(math.finiteSet(['sqrt(2) - 1']).contains('1/(1 + sqrt(2))'), true)
        assert.strictEqual(math.expression('1/(1 + sqrt(2))').compare('sqrt(2) - 1'), 0)
        assert.strictEqual(math.finiteSet(['i', 1, '-i', 'a']).toString(), '{1, i, -i, a}')
        assert.strictEqual(math.finiteSet([]).complement().toString(), '(-inf, inf)')
        assert.strictEqual(math.interval('-inf', 'inf').complement().toString(), '{}')
        assert.strictEqual(math.interval('-inf', 0, {endOpen: true}).union(math.interval(0, 'inf', {startOpen: true})).complement().toString(), '{0}')
        assert.strictEqual(math.interval(2, 1).kind, 'empty')
        assert.strictEqual(math.interval(1, 1).toString(), '{1}')
        assert.ok(math.interval(0, 1).union(math.interval(2, 3)).equals(math.interval(2, 3).union(math.interval(0, 1))))
        assert.ok(!math.interval(0, 1).equals(math.interval(0, 1, {endOpen: true})))
        assert.throws((): unknown => math.interval('a', 'b'), MathNotSupportedException)
        //Every value; a set described in text, which the operations do not take
        const all: MathSet = math.equation('x = x').solve('x').set
        assert.strictEqual(all.union(set).kind, 'all')
        assert.ok(all.intersect(set).equals(set))
        assert.strictEqual(all.complement().kind, 'empty')
        assert.strictEqual(all.contains('i'), true)
        const periodic: MathSet = math.expression('sin(x)').solve('x').set
        assert.strictEqual(periodic.contains(0), undefined)
        assert.throws((): unknown => periodic.union(set), MathNotSupportedException)
        //The sets of the solutions of inequalities combine
        const both: MathSet = solve('x^2 < 4').set.intersect(solve('x > 1/2').set)
        assert.strictEqual(both.toString(), '(1/2, 2)')
    })
})
