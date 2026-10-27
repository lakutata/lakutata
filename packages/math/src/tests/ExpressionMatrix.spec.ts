import {describe, it} from 'node:test'
import assert from 'node:assert'
import {
    createMath,
    type Expression,
    ExpressionMatrix,
    MathArgumentException,
    MathCancelledException,
    MathDefinitionException,
    MathDivisionByZeroException,
    MathDomainException,
    MathNotSupportedException,
    type MathScope,
    MathSyntaxException,
    Matrix
} from '../exports/Math.js'

describe('The matrices of expressions', (): void => {
    const math: MathScope = createMath()
    const text = (matrix: ExpressionMatrix): string => matrix.toString()

    it('are made of rows, of formulas and of matrices of numbers, and do not change', (): void => {
        const m: ExpressionMatrix = math.expressionMatrix([['a', 'b'], ['c', 2.5]])
        assert.ok(m.rows === 2 && m.columns === 2 && text(m) === '[a, b; c, 5/2]')
        assert.strictEqual(text(math.expressionMatrix('[1, x; x^2, 2]')), '[1, x; x^2, 2]')
        assert.strictEqual(text(math.expressionMatrix(new Matrix(1, 2, Float64Array.of(0.1, 3)))), '[1/10, 3]')
        assert.strictEqual(m.get(1, 0).toString(), 'c')
        assert.deepStrictEqual(m.toArray().map((row: Expression[]): string[] => row.map(String)), [['a', 'b'], ['c', '5/2']])
        //with() gives another matrix: this one is the same
        assert.ok(text(m.with(0, 1, 'x^2')) === '[a, x^2; c, 5/2]' && text(m) === '[a, b; c, 5/2]')
        assert.ok(text(m.row(1)) === '[c, 5/2]' && text(m.column(0)) === '[a; c]' && text(m.transpose()) === '[a, c; b, 5/2]')
        assert.ok(text(m.withRow(0, ['x', 1])) === '[x, 1; c, 5/2]' && text(m.withColumn(1, math.expressionMatrix('[y, 2]'))) === '[a, y; c, 2]' && text(m) === '[a, b; c, 5/2]')
        assert.throws((): unknown => m.withRow(2, [1, 2]), MathArgumentException)
        assert.throws((): unknown => m.withColumn(0, [1, 2, 3]), MathArgumentException)
        assert.throws((): unknown => m.withRow(0, math.expressionMatrix('[1, 2; 3, 4]')), MathArgumentException)
        assert.strictEqual(text(math.expressionMatrix('[1, 2, 3; 4, 5, 6]').submatrix(0, 1, 2, 2)), '[2, 3; 5, 6]')
        assert.strictEqual(m.toTeX(), '\\begin{bmatrix}a & b \\\\ c & \\frac{5}{2}\\end{bmatrix}')
        assert.ok(math.parse(text(m)) instanceof ExpressionMatrix && m.equals(text(m)))
    })

    it('add, multiply and raise to integer powers, element by element too', (): void => {
        const a: ExpressionMatrix = math.expressionMatrix('[1, 2; 3, 4]'), x: ExpressionMatrix = math.expressionMatrix('[x; y]')
        assert.strictEqual(text(a.mul(x)), '[x + 2y; 3x + 4y]')
        assert.ok(text(a.add(a)) === '[2, 4; 6, 8]' && text(a.sub(a)) === '[0, 0; 0, 0]' && text(a.neg()) === '[-1, -2; -3, -4]')
        assert.ok(text(a.mul('t')) === '[t, 2t; 3t, 4t]' && text(a.div(2)) === '[1/2, 1; 3/2, 2]' && text(a.mul('[0, 1; 1, 0]')) === '[2, 1; 4, 3]')
        assert.ok(text(a.multiplyElements(a)) === '[1, 4; 9, 16]' && text(a.pow(2)) === '[7, 10; 15, 22]' && text(a.pow(0)) === '[1, 0; 0, 1]')
        assert.ok(a.pow(-2).equals(a.inverse().pow(2)) && a.trace().toString() === '5')
        assert.strictEqual(text(math.expressionMatrix([['sin(t)^2', 't^3']]).diff('t')), '[2cos(t)*sin(t), 3t^2]')
        assert.strictEqual(text(math.expressionMatrix('[(x + 1)^2, x*y]').substitute({x: 2}).expand()), '[9, 2y]')
        assert.strictEqual(math.expressionMatrix('[1/2, sqrt(2); pi, 3]').toMatrix().toString(), '[0.5, 1.4142135623730951; 3.141592653589793, 3]')
        assert.strictEqual(text(math.jacobian(['x^2*y', 'x + sin(y)'], ['x', 'y'])), '[2x*y, x^2; 1, cos(y)]')
    })

    it('give determinants, inverses, solutions, echelon forms, ranks and null spaces, exactly', async (): Promise<void> => {
        const m: ExpressionMatrix = math.expressionMatrix([['a', 'b'], ['c', 'd']])
        assert.strictEqual(m.determinant().toString(), 'a*d - b*c')
        assert.strictEqual(text(m.inverse()), '[d/(a*d - b*c), -b/(a*d - b*c); -c/(a*d - b*c), a/(a*d - b*c)]')
        //Its elements are fractions of polynomials: the product is the identity at any values
        assert.ok(m.inverse().mul(m).substitute({a: 2, b: 3, c: 5, d: 7}).equals('[1, 0; 0, 1]'))
        assert.strictEqual(text(math.expressionMatrix('[2, 1; 1, 3]').solve([3, 5])), '[4/5; 7/5]')
        assert.strictEqual(text(math.expressionMatrix('[1, 2; 3, 4]').inverse()), '[-2, 1; 3/2, -1/2]')
        const rref = math.expressionMatrix('[1, 2, 3; 4, 5, 6; 7, 8, 9]').rref()
        assert.ok(text(rref.matrix) === '[1, 0, -1; 0, 1, 2; 0, 0, 0]' && rref.pivots.join() === '0,1')
        assert.strictEqual(math.expressionMatrix('[1, 2, 3; 4, 5, 6; 7, 8, 9]').rank(), 2)
        assert.deepStrictEqual(math.expressionMatrix('[1, 2, 3; 4, 5, 6; 7, 8, 9]').nullspace().map(text), ['[1; -2; 1]'])
        //Zero with variables (x x - x^2), and as a constant told by its decimals (ln(6) - ln(2) - ln(3))
        assert.strictEqual(math.expressionMatrix('[x, x^2; 1, x]').rank(), 1)
        assert.strictEqual(math.expressionMatrix('[ln(6), ln(2) + ln(3); 1, 1]').rank(), 1)
        assert.strictEqual((await math.expressionMatrix('[1, 2; 3, 4]').determinantAsync()).toString(), '-2')
        assert.strictEqual(text(await math.expressionMatrix('[1, 2; 3, 4]').inverseAsync()), '[-2, 1; 3/2, -1/2]')
        assert.strictEqual(text(await math.expressionMatrix('[2, 1; 1, 3]').solveAsync([3, 5])), '[4/5; 7/5]')
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.expressionMatrix('[1, 2; 3, 4]').determinantAsync({signal: controller.signal}), MathCancelledException)
    })

    it('give characteristic polynomials, eigenvalues with their multiplicities and eigenvectors', async (): Promise<void> => {
        assert.strictEqual(math.expressionMatrix('[1, 2; 3, 4]').characteristicPolynomial().toString(), 'lambda^2 - 5lambda - 2')
        assert.strictEqual(math.expressionMatrix('[1, 2; 3, 4]').characteristicPolynomial('t').toString(), 't^2 - 5t - 2')
        const eigen = (value: string): [string, number, string[]][] => math.expressionMatrix(value).eigenvectors().map(({value: v, multiplicity, vectors}): [string, number, string[]] => [v.toString(), multiplicity, vectors.map(text)])
        assert.deepStrictEqual(eigen('[2, 1; 1, 2]'), [['1', 1, ['[-1; 1]']], ['3', 1, ['[1; 1]']]])
        //Defective: multiplicity 2, one eigenvector
        assert.deepStrictEqual(eigen('[1, 1; 0, 1]'), [['1', 2, ['[1; 0]']]])
        //Rational roots of the characteristic polynomial, radicals
        assert.deepStrictEqual(eigen('[2, 0, 0; 0, 3, 4; 0, 4, 9]').map(([value]: [string, number, string[]]): string => value), ['1', '2', '11'])
        assert.deepStrictEqual(eigen('[0, 1; 2, 0]'), [['-sqrt(2)', 1, ['[-sqrt(2)/2; 1]']], ['sqrt(2)', 1, ['[sqrt(2)/2; 1]']]])
        //The elements of the diagonal first: a and b, not the formula of the quadratic (sqrt((a - b)^2))
        assert.deepStrictEqual(eigen('[a, 0; 0, b]'), [['a', 1, ['[1; 0]']], ['b', 1, ['[0; 1]']]])
        const vectors = await math.expressionMatrix('[2, 1; 1, 2]').eigenvectorsAsync()
        assert.strictEqual(vectors.length, 2)
        assert.deepStrictEqual(math.expressionMatrix('[4, 1; 2, 3]').eigenvalues().map(({value, multiplicity}): string => `${value}:${multiplicity}`), ['2:1', '5:1'])
    })

    it('are written in the formulas: [a, b; c, d], their operations, det, inv, transpose and trace', (): void => {
        const parsed = (formula: string): string => String(math.parse(formula))
        assert.strictEqual(parsed('[1, 2; 3, 4] * [x; y] + [1; 1]'), '[x + 2y + 1; 3x + 4y + 1]')
        assert.strictEqual(parsed('det([a, b; c, d]) + 1'), 'a*d - b*c + 1')
        assert.ok(parsed('inv([1, 2; 3, 4])^2') === '[11/2, -5/2; -15/4, 7/4]' && parsed('[1, 2; 3, 4]^-1') === '[-2, 1; 3/2, -1/2]')
        assert.ok(parsed('transpose([1, x, x^2])') === '[1; x; x^2]' && parsed('trace([a, 1; 2, b])') === 'a + b' && parsed('2[1, 2]') === '[2, 4]')
        assert.strictEqual(parsed('-[1, 2]/2'), '[-1/2, -1]')
        //det without parentheses is a variable; it cannot be defined
        assert.strictEqual(parsed('det + 1'), 'det + 1')
        assert.throws((): unknown => createMath({definitions: {'det(x)': 'x'}}), MathDefinitionException)
        for (const [formula, exception] of [
            ['[1, 2] + 3', MathSyntaxException], ['[1, 2; 3]', MathSyntaxException], ['[]', MathSyntaxException], ['[[1], 2]', MathSyntaxException],
            ['[1, 2; 3, 4]^(1/2)', MathNotSupportedException], ['[x, y] = [1, 2]', MathNotSupportedException], ['sin([1, 2])', MathSyntaxException],
            ['det(5)', MathSyntaxException], ['3/[1, 2]', MathSyntaxException], ['[1, 2]/0', MathDivisionByZeroException], ['[1, 2] * [3, 4]', MathArgumentException],
            ['det([1, 2])', MathArgumentException], ['[1, 2]!', MathSyntaxException], ['2^[1, 2]', MathSyntaxException], ['inv([1, 2; 2, 4])', MathDomainException]
        ] as [string, typeof MathSyntaxException][]) assert.throws((): unknown => math.parse(formula), exception, formula)
        assert.throws((): unknown => math.expression('[1, 2]'), MathSyntaxException)
        assert.throws((): unknown => math.equation('[1, 2]'), MathSyntaxException)
        assert.throws((): unknown => createMath({definitions: {'m': '[1, 2]'}}), MathDefinitionException)
    })

    it('throw the exceptions of the package', (): void => {
        const a: ExpressionMatrix = math.expressionMatrix('[1, 2; 3, 4]')
        for (const [operation, exception] of [
            [(): unknown => math.expressionMatrix([[1, 2], [3]]), MathArgumentException],
            [(): unknown => math.expressionMatrix([]), MathArgumentException],
            [(): unknown => math.expressionMatrix('x + 1'), MathArgumentException],
            [(): unknown => a.get(2, 0), MathArgumentException],
            [(): unknown => a.add('[1, 2]'), MathArgumentException],
            [(): unknown => a.mul('[1, 2, 3]'), MathArgumentException],
            [(): unknown => a.div(0), MathDivisionByZeroException],
            [(): unknown => a.pow(0.5), MathArgumentException],
            [(): unknown => math.expressionMatrix('[1, 2; 2, 4]').inverse(), MathDomainException],
            [(): unknown => math.expressionMatrix('[x, x^2; 1, x]').solve([1, 2]), MathDomainException],
            [(): unknown => math.expressionMatrix('[1, 2, 3]').determinant(), MathArgumentException],
            [(): unknown => math.expressionMatrix('[1, 2, 3]').solve([1]), MathArgumentException],
            [(): unknown => math.expressionMatrix('[lambda, 1; 0, 1]').characteristicPolynomial(), MathArgumentException],
            //x^5 - x - 1, whose roots have no radicals
            [(): unknown => math.expressionMatrix('[0, 1, 0, 0, 0; 0, 0, 1, 0, 0; 0, 0, 0, 1, 0; 0, 0, 0, 0, 1; 1, 1, 0, 0, 0]').eigenvalues(), MathNotSupportedException],
            [(): unknown => math.expressionMatrix('[x, 1]').toMatrix(), MathArgumentException]
        ] as [() => unknown, typeof MathArgumentException][]) assert.throws(operation, exception)
    })
})
