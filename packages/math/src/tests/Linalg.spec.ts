import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    Math,
    MathArgumentException,
    MathCancelledException,
    MathDomainException,
    Matrix
} from '../exports/Math.js'

//Two arrays of numbers within a tolerance of each other
function close(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance: number = 1e-12): boolean {
    if (actual.length !== expected.length) return false
    for (let i: number = 0; i < actual.length; i++) {
        if (!(globalThis.Math.abs(actual[i] - expected[i]) <= tolerance)) return false
    }
    return true
}

describe('The matrices and the linear algebra', (): void => {
    let container: Container
    let math: Math

    before(async (): Promise<void> => {
        container = new Container()
        await container.setNamed('math', Math, {})
        math = await container.get<Math>('math')
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('hold their elements row by row, read and written in place', (): void => {
        const a: Matrix = math.matrix([[1, 2, 3], [4, 5, 6]])
        assert.deepStrictEqual([a.rows, a.columns, Array.from(a.data)], [2, 3, [1, 2, 3, 4, 5, 6]])
        assert.strictEqual(a.get(1, 2), 6)
        assert.deepStrictEqual(Array.from(a.row(1)), [4, 5, 6])
        assert.deepStrictEqual(Array.from(a.column(1)), [2, 5])
        assert.deepStrictEqual(Array.from(a.diagonal()), [1, 5])
        assert.strictEqual(a.submatrix(0, 2, 1, 3).toString(), '[2, 3; 5, 6]')
        assert.strictEqual(a.reshape(3, 2).toString(), '[1, 2; 3, 4; 5, 6]')
        assert.strictEqual(a.transpose().toString(), '[1, 4; 2, 5; 3, 6]')
        assert.deepStrictEqual(a.toArray(), [[1, 2, 3], [4, 5, 6]])
        assert.strictEqual(JSON.stringify({a: a}), '{"a":[[1,2,3],[4,5,6]]}')
        //A copy does not change with the matrix; a matrix of a matrix is a copy
        const copy: Matrix = a.clone()
        a.set(0, 0, 9)
        assert.strictEqual(copy.get(0, 0), 1)
        assert.strictEqual(math.matrix(a).set(0, 0, 7).get(0, 0), 7)
        assert.strictEqual(a.get(0, 0), 9)
        //A Matrix of a Float64Array uses it as it is
        const data: Float64Array = Float64Array.of(1, 2, 3, 4)
        new Matrix(2, 2, data).set(1, 1, 0)
        assert.strictEqual(data[3], 0)
        assert.strictEqual(new Matrix(0, 0).toString(), '[]')
    })

    it('compute the arithmetic of their elements, and their products by Eigen', (): void => {
        const a: Matrix = math.matrix([[4, 1], [2, 3]])
        assert.strictEqual(a.add(a).toString(), '[8, 2; 4, 6]')
        assert.strictEqual(a.sub(1).toString(), '[3, 0; 1, 2]')
        assert.strictEqual(a.mul(2).toString(), '[8, 2; 4, 6]')
        assert.strictEqual(a.mul(a).toString(), '[18, 7; 14, 11]')
        assert.deepStrictEqual(a.mul([1, 1]), Float64Array.of(5, 5))
        assert.strictEqual(a.div(2).toString(), '[2, 0.5; 1, 1.5]')
        assert.strictEqual(a.neg().toString(), '[-4, -1; -2, -3]')
        assert.strictEqual(a.multiplyElements([[1, 2], [3, 4]]).toString(), '[4, 2; 6, 12]')
        assert.strictEqual(a.divideElements([[2, 1], [1, 3]]).toString(), '[2, 1; 2, 1]')
        assert.strictEqual(a.powElements(2).toString(), '[16, 1; 4, 9]')
        assert.strictEqual(a.map((value: number, i: number, j: number): number => value + 10 * i + 100 * j).toString(), '[4, 101; 12, 113]')
        assert.strictEqual(a.trace(), 7)
        assert.strictEqual(a.kron([[1, 0], [0, 1]]).toString(), '[4, 0, 1, 0; 0, 4, 0, 1; 2, 0, 3, 0; 0, 2, 0, 3]')
        assert.ok(a.equals([[4, 1], [2, 3]]) && !a.equals([[4, 1], [2, 3.1]]) && a.equals([[4, 1], [2, 3.1]], 0.2) && !a.equals([[4, 1]]))
        //A product of large matrices is the one of the definition
        const n: number = 60
        const b: Matrix = math.linalg.fromFunction(n, n, (i: number, j: number): number => globalThis.Math.sin(i + 2 * j))
        const product: Matrix = b.mul(b)
        let element: number = 0
        for (let k: number = 0; k < n; k++) element += b.get(7, k) * b.get(k, 11)
        assert.ok(globalThis.Math.abs(product.get(7, 11) - element) < 1e-12)
    })

    it('are made of zeros, ones, diagonals, rows, columns, functions, other matrices and rotations', (): void => {
        assert.strictEqual(math.linalg.zeros(2, 3).toString(), '[0, 0, 0; 0, 0, 0]')
        assert.strictEqual(math.linalg.ones(2).toString(), '[1, 1; 1, 1]')
        assert.strictEqual(math.linalg.identity(3).toString(), '[1, 0, 0; 0, 1, 0; 0, 0, 1]')
        assert.strictEqual(math.linalg.diagonal([1, 2]).toString(), '[1, 0; 0, 2]')
        assert.strictEqual(math.linalg.fromRows([[1, 2], Float64Array.of(3, 4)]).toString(), '[1, 2; 3, 4]')
        assert.strictEqual(math.linalg.fromColumns([[1, 2], [3, 4]]).toString(), '[1, 3; 2, 4]')
        assert.strictEqual(math.linalg.fromFunction(2, 2, (i: number, j: number): number => i - j).toString(), '[0, -1; 1, 0]')
        assert.strictEqual(math.linalg.concat([[[1, 2]], [[3, 4]]]).toString(), '[1, 2; 3, 4]')
        assert.strictEqual(math.linalg.concat([[[1], [2]], [[3], [4]]], 'horizontal').toString(), '[1, 3; 2, 4]')
        assert.ok(close(math.linalg.rotation(globalThis.Math.PI / 2).mul([1, 0]), [0, 1]))
        assert.ok(close(math.linalg.rotation(globalThis.Math.PI / 2, [0, 0, 2]).mul([1, 0, 0]), [0, 1, 0]))
        assert.ok(close(math.linalg.rotation(2 * globalThis.Math.PI / 3, [1, 1, 1]).mul([1, 0, 0]), [0, 1, 0]))
        assert.strictEqual(math.linalg.dot([1, 2, 3], [4, 5, 6]), 32)
        assert.deepStrictEqual(math.linalg.cross([1, 0, 0], [0, 1, 0]), Float64Array.of(0, 0, 1))
        assert.strictEqual(math.linalg.outer([1, 2], [3, 4, 5]).toString(), '[3, 4, 5; 6, 8, 10]')
    })

    it('give the norms of vectors and of matrices', (): void => {
        assert.strictEqual(math.linalg.norm([3, 4]), 5)
        assert.strictEqual(math.linalg.norm([3, -4], 1), 7)
        assert.strictEqual(math.linalg.norm([3, -4], Infinity), 4)
        assert.ok(globalThis.Math.abs(math.linalg.norm([1, 2, 2], 3) - globalThis.Math.cbrt(17)) < 1e-15)
        assert.strictEqual(math.linalg.norm([1e200, 1e200]), 1e200 * globalThis.Math.SQRT2)
        assert.strictEqual(math.linalg.norm([[1, -2], [3, 4]], 1), 6)
        assert.strictEqual(math.linalg.norm([[1, -2], [3, 4]], Infinity), 7)
        assert.strictEqual(math.linalg.norm([[3, 0], [0, 4]]), 5)
        assert.ok(globalThis.Math.abs(math.linalg.norm([[3, 0], [0, 4]], 2) - 4) < 1e-15)
    })

    it('solve linear systems, a vector giving a vector and a matrix a matrix', (): void => {
        const a: number[][] = [[4, 1], [2, 3]]
        assert.deepStrictEqual(math.linalg.solve(a, [5, 5]), Float64Array.of(1, 1))
        const x: Matrix = math.linalg.solve(a, [[5, 1], [5, 2]])
        assert.ok(x instanceof Matrix && x.equals([[1, 0.1], [1, 0.6]], 1e-15))
        assert.deepStrictEqual(math.linalg.solveTriangular([[2, 99], [1, 1]], [2, 3], 'lower'), Float64Array.of(1, 2))
        assert.deepStrictEqual(math.linalg.solveTriangular([[2, 2], [99, 1]], [4, 1], 'upper'), Float64Array.of(1, 1))
        assert.strictEqual(math.linalg.inverse(a).toString(), '[0.3, -0.1; -0.2, 0.4]')
        assert.strictEqual(math.linalg.determinant(a), 10)
        assert.strictEqual(math.linalg.determinant([[1, 2], [2, 4]]), 0)
        assert.strictEqual(math.linalg.determinant(new Matrix(0, 0)), 1)
        assert.strictEqual(math.linalg.rank([[1, 2], [2, 4]]), 1)
        assert.strictEqual(math.linalg.rank([[1, 0], [0, 1e-10]]), 2)
        assert.strictEqual(math.linalg.rank([[1, 0], [0, 1e-10]], 1e-8), 1)
        assert.strictEqual(math.linalg.condition([[2, 0], [0, 1]]), 2)
        assert.strictEqual(math.linalg.condition([[1, 2], [2, 4]]) > 1e15, true)
        //Least squares: the line through three points, the least norm of an underdetermined system
        assert.ok(close(math.linalg.leastSquares([[1, 1], [1, 2], [1, 3]], [1, 2, 2]), [2 / 3, 0.5]))
        assert.ok(close(math.linalg.leastSquares([[1, 1]], [2]), [1, 1]))
        assert.ok(close(math.linalg.leastSquares([[1, 2], [2, 4]], [1, 2]), [0.2, 0.4]))
    })

    it('decompose matrices: LU, QR, Cholesky, singular values, eigenvalues, Schur, the pseudo-inverse', async (): Promise<void> => {
        //P A = L U, row i of P A being row permutation[i] of A
        const {lower, upper, permutation} = math.linalg.lu([[1, 2], [3, 4]])
        assert.deepStrictEqual(permutation, [1, 0])
        assert.strictEqual(lower.toString(), '[1, 0; 0.3333333333333333, 1]')
        assert.ok(upper.equals([[3, 4], [0, 2 / 3]], 1e-15))
        assert.deepStrictEqual(math.linalg.lu([[1, 2], [2, 4]]).upper.diagonal()[1], 0)
        const {q, r} = math.linalg.qr([[3, 0], [4, 5], [0, 0]])
        assert.deepStrictEqual([q.rows, q.columns, r.rows, r.columns], [3, 2, 2, 2])
        assert.ok(q.mul(r).equals([[3, 0], [4, 5], [0, 0]], 1e-14))
        assert.strictEqual(math.linalg.cholesky([[4, 2], [2, 5]]).toString(), '[2, 0; 1, 2]')
        //Only the lower triangle is read
        assert.strictEqual(math.linalg.cholesky([[4, 99], [2, 5]]).toString(), '[2, 0; 1, 2]')
        const {u, singularValues, v} = math.linalg.svd([[3, 0], [0, -4]])
        assert.deepStrictEqual(singularValues, Float64Array.of(4, 3))
        assert.ok(u.mul(math.linalg.diagonal(singularValues)).mul(v.transpose()).equals([[3, 0], [0, -4]], 1e-14))
        const {values, vectors} = math.linalg.eigen([[0, -1], [1, 0]])
        assert.ok(close(Array.from(values.re), [0, 0]) && close(Array.from(values.im).sort(), [-1, 1]))
        assert.deepStrictEqual([vectors.re.rows, vectors.im.columns], [2, 2])
        const symmetric = math.linalg.symmetricEigen([[2, 1], [1, 2]])
        assert.ok(close(symmetric.values, [1, 3]))
        assert.ok(symmetric.vectors.transpose().mul(symmetric.vectors).equals(math.linalg.identity(2), 1e-15))
        //The lower triangle of a matrix that is not symmetric
        assert.ok(close(math.linalg.symmetricEigen([[2, 99], [1, 2]]).values, [1, 3]))
        const schur = math.linalg.schur([[1, 2], [3, 4]])
        assert.ok(schur.u.mul(schur.t).mul(schur.u.transpose()).equals([[1, 2], [3, 4]], 1e-14) && schur.t.get(1, 0) === 0)
        assert.ok(math.linalg.pseudoInverse([[1, 2], [2, 4]]).equals([[0.04, 0.08], [0.08, 0.16]], 1e-15))
        assert.ok(math.linalg.pseudoInverse([[1, 0], [0, 1e-10]], 1e-8).equals([[1, 0], [0, 0]]))
        assert.ok(math.linalg.pseudoInverse([[1, 1], [1, 2], [1, 3]]).mul([1, 2, 2]).every((value: number, i: number): boolean => globalThis.Math.abs(value - [2 / 3, 0.5][i]) < 1e-14))
        //In the threads of the addon
        assert.deepStrictEqual((await math.linalg.luAsync([[1, 2], [3, 4]])).permutation, [1, 0])
        assert.strictEqual((await math.linalg.choleskyAsync([[4, 2], [2, 5]])).toString(), '[2, 0; 1, 2]')
        assert.deepStrictEqual((await math.linalg.svdAsync([[3, 0], [0, -4]])).singularValues, Float64Array.of(4, 3))
        assert.ok(close((await math.linalg.symmetricEigenAsync([[2, 1], [1, 2]])).values, [1, 3]))
        assert.strictEqual((await math.linalg.eigenAsync([[2]])).values.re[0], 2)
        assert.strictEqual((await math.linalg.qrAsync([[2]])).r.get(0, 0) ** 2, 4)
        assert.strictEqual((await math.linalg.schurAsync([[2]])).t.get(0, 0), 2)
        assert.ok((await math.linalg.pseudoInverseAsync([[2]])).equals([[0.5]]))
        await assert.rejects(math.linalg.choleskyAsync([[1, 2], [2, 1]]), MathDomainException)
    })

    it('throw the exceptions of the package', (): void => {
        const cases: [() => unknown, new (...args: never[]) => Error][] = [
            [(): unknown => math.linalg.solve([[1, 2], [2, 4]], [1, 2]), MathDomainException],
            [(): unknown => math.linalg.inverse([[0, 0], [0, 0]]), MathDomainException],
            [(): unknown => math.linalg.solveTriangular([[1, 0], [1, 0]], [1, 1], 'lower'), MathDomainException],
            [(): unknown => math.linalg.solve([[1, 2, 3]], [1]), MathArgumentException],
            [(): unknown => math.linalg.solve([[1, 2], [3, 4]], [1, 2, 3]), MathArgumentException],
            [(): unknown => math.linalg.inverse([[1, 2, 3]]), MathArgumentException],
            [(): unknown => math.linalg.determinant([[1, 2]]), MathArgumentException],
            [(): unknown => math.matrix([[1, 2], [3]]), MathArgumentException],
            [(): unknown => math.matrix([[1, '2' as unknown as number]]), MathArgumentException],
            [(): unknown => math.matrix([[1, 2]]).mul([[1, 2]]), MathArgumentException],
            [(): unknown => math.matrix([[1, 2]]).add([[1, 2, 3]]), MathArgumentException],
            [(): unknown => math.matrix([[1, 2]]).get(1, 0), MathArgumentException],
            [(): unknown => math.matrix([[1, 2]]).reshape(3, 1), MathArgumentException],
            [(): unknown => math.matrix([[1, 2]]).trace(), MathArgumentException],
            [(): unknown => new Matrix(2, 2, Float64Array.of(1)), MathArgumentException],
            [(): unknown => new Matrix(1.5, 2), MathArgumentException],
            [(): unknown => math.linalg.cross([1, 2], [3, 4]), MathArgumentException],
            [(): unknown => math.linalg.dot([1, 2], [3]), MathArgumentException],
            [(): unknown => math.linalg.norm([1, 2], 0.5), MathArgumentException],
            [(): unknown => math.linalg.norm([1, 2], 'fro'), MathArgumentException],
            [(): unknown => math.linalg.norm([[1, 2]], 3), MathArgumentException],
            [(): unknown => math.linalg.rotation(1, [0, 0, 0]), MathArgumentException],
            [(): unknown => math.linalg.solveTriangular([[1]], [1], 'middle' as 'lower'), MathArgumentException],
            [(): unknown => math.linalg.cholesky([[1, 2], [2, 1]]), MathDomainException],
            [(): unknown => math.linalg.cholesky([[1, 2]]), MathArgumentException],
            [(): unknown => math.linalg.lu([[1, 2]]), MathArgumentException],
            [(): unknown => math.linalg.eigen([[1, 2]]), MathArgumentException],
            [(): unknown => math.linalg.symmetricEigen([[1, 2]]), MathArgumentException],
            [(): unknown => math.linalg.schur([[1, 2]]), MathArgumentException],
            [(): unknown => math.linalg.pseudoInverse([[1]], -1), MathArgumentException]
        ]
        cases.forEach(([operate, exception]: [() => unknown, new (...args: never[]) => Error], index: number): void => {
            assert.throws(operate, exception, `case ${index}`)
        })
    })

    it('compute in the threads of the addon on copies of their arguments', async (): Promise<void> => {
        const n: number = 200
        const a: Matrix = math.linalg.fromFunction(n, n, (i: number, j: number): number => i === j ? n : 1 / (1 + i + j))
        const b: Float64Array = new Float64Array(n).fill(1)
        const running: Promise<Float64Array> = math.linalg.solveAsync(a, b)
        //The arguments may change once the operation is called: it has its copies
        a.data.fill(0)
        b.fill(0)
        const x: Float64Array = await running
        const original: Matrix = math.linalg.fromFunction(n, n, (i: number, j: number): number => i === j ? n : 1 / (1 + i + j))
        assert.ok(close(original.mul(x), new Float64Array(n).fill(1), 1e-12))
        assert.ok((await math.linalg.inverseAsync(original)).mul(original).equals(math.linalg.identity(n), 1e-12))
        assert.ok(globalThis.Math.abs(await math.linalg.determinantAsync([[4, 1], [2, 3]]) - 10) < 1e-14)
        assert.ok((await math.linalg.multiplyAsync([[1, 2]], [[3], [4]])).equals([[11]]))
        assert.deepStrictEqual(await math.linalg.multiplyAsync([[1, 2]], [3, 4]), Float64Array.of(11))
        assert.strictEqual(await math.linalg.rankAsync([[1, 2], [2, 4]]), 1)
        assert.strictEqual(await math.linalg.conditionAsync([[2, 0], [0, 1]]), 2)
        assert.ok(globalThis.Math.abs(await math.linalg.normAsync([[3, 0], [0, 4]], 2) - 4) < 1e-15)
        assert.ok(close(await math.linalg.leastSquaresAsync([[1, 1], [1, 2], [1, 3]], [1, 2, 2]), [2 / 3, 0.5]))
        await assert.rejects(math.linalg.inverseAsync([[1, 2], [2, 4]]), MathDomainException)
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.linalg.solveAsync(a, b, {signal: controller.signal}), MathCancelledException)
    })
})
