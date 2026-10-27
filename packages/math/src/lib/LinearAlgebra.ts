import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {
    isVector,
    linalgRun,
    Matrix,
    matrixFrom,
    matrixOf,
    type MatrixValue,
    type NativeMatrix,
    nativeColumnOf,
    nativeOf,
    vectorOf,
    type VectorValue
} from './Matrix.js'

/**
 * The norm of a vector or of a matrix: a number `p` of 1 or more, or `Infinity`, for a vector (the p-norm); `'fro'`
 * (Frobenius), 1 (the largest sum of the absolute values of a column), 2 (the largest singular value) or `Infinity`
 * (the largest sum of a row) for a matrix
 */
export type NormKind = number | 'fro'

/**
 * The operand of the right side of a system: a vector gives a vector, a matrix (columns of right sides) a matrix
 */
interface Operand {
    native: NativeMatrix
    vector: boolean
}

function operandOf(value: MatrixValue | VectorValue, what: string): Operand {
    if (isVector(value)) return {native: nativeColumnOf(vectorOf(value, what)), vector: true}
    return {native: nativeOf(matrixOf(value, what)), vector: false}
}

function shapeOf(result: NativeMatrix, vector: boolean): Matrix | Float64Array {
    return vector ? result[2] : matrixFrom(result)
}

function sameLength(u: Float64Array, v: Float64Array, operation: string): void {
    if (u.length !== v.length) throw new MathArgumentException(`The vectors of ${operation} differ in length: ${u.length} and ${v.length}`)
}

/**
 * The rank of a matrix of singular values: those above a tolerance, by default the largest one times
 * `max(rows, columns)` times the machine epsilon (NumPy's)
 * @param values
 * @param rows
 * @param columns
 * @param tolerance
 */
function rankOf(values: Float64Array, rows: number, columns: number, tolerance?: number): number {
    const threshold: number = tolerance ?? (values.length ? values[0] * Math.max(rows, columns) * Number.EPSILON : 0)
    return values.filter((value: number): boolean => value > threshold).length
}

/**
 * The Euclidean norm of values, scaled by the largest one (no overflow of the squares of large values)
 * @param values
 */
function euclidean(values: Float64Array): number {
    let largest: number = 0
    for (const value of values) largest = Math.max(largest, Math.abs(value))
    if (largest === 0 || !Number.isFinite(largest)) return largest
    let sum: number = 0
    for (const value of values) sum += (value / largest) ** 2
    return largest * Math.sqrt(sum)
}

function conditionOf(values: Float64Array): number {
    if (!values.length) return 0
    const smallest: number = values[values.length - 1]
    return smallest === 0 ? Infinity : values[0] / smallest
}

/**
 * The numeric linear algebra of matrices of doubles (`Matrix`) and vectors (`Float64Array`), on Eigen: matrices of
 * zeros, of ones, identities, diagonals, rotations; products, dot and cross products; norms; the solutions of linear
 * systems, least squares, inverses, determinants, ranks, condition numbers and singular values. It is `math.linalg` of a
 * `Math` component.
 *
 * Where a vector is expected, a `Float64Array` or an array of numbers is given; where a matrix is, a `Matrix` or its
 * rows (`[[1, 2], [3, 4]]`). A system with a vector on its right side has a vector for solution, one with a matrix (one
 * right side by column) a matrix.
 *
 * For `solve()` and `inverse()`, a matrix is singular when its LU decomposition with partial pivoting meets a pivot of
 * exactly 0, as in NumPy: a matrix close to singular gives large values, not an error; `condition()` tells how close it
 * is. A singular matrix throws `MathDomainException`, matrices of the wrong
 * dimensions `MathArgumentException`.
 *
 * The operations that take long on large matrices have an asynchronous version (`solveAsync()`…), in the threads of the
 * addon. Eigen's computations have no point where they stop: at the time limit or the cancellation, the promise is
 * rejected, and its thread finishes the work before it is free again.
 * @example
 * ```typescript
 * import {Container} from 'lakutata'
 * import {Math} from '@lakutata/math'
 *
 * const container: Container = new Container()
 * await container.setNamed('math', Math, {})
 * const math: Math = await container.get<Math>('math')
 * const a = math.matrix([[4, 1], [2, 3]])
 * math.linalg.solve(a, [5, 5])                         //Float64Array [1, 1]
 * math.linalg.determinant(a)                           //10
 * math.linalg.inverse(a).toString()                    //[0.3, -0.1; -0.2, 0.4]
 * math.linalg.rank([[1, 2], [2, 4]])                   //1
 * math.linalg.norm([3, 4])                             //5
 * const x = await math.linalg.solveAsync(math.linalg.identity(500), new Float64Array(500).fill(1))
 * await container.destroy()
 * ```
 */
export class LinearAlgebra {

    constructor(protected readonly context: Context) {
    }

    async #runAsync(operation: string, matrices: NativeMatrix[], options: AsyncOptions | undefined, numbers: number[] = [], option: string = ''): Promise<NativeMatrix[]> {
        //The elements copied at the call, before the operation waits for its turn: the matrices given may change then
        const copies: NativeMatrix[] = matrices.map(([rows, columns, data]: NativeMatrix): NativeMatrix => [rows, columns, data.slice()])
        return await this.context.runAsync<NativeMatrix[]>('linalg', [operation, copies, numbers, option], options)
    }

    /**
     * A matrix of zeros.
     * @param rows The rows.
     * @param columns The columns: as many as the rows by default.
     */
    public zeros(rows: number, columns: number = rows): Matrix {
        return new Matrix(rows, columns)
    }

    /**
     * A matrix of ones.
     * @param rows The rows.
     * @param columns The columns: as many as the rows by default.
     */
    public ones(rows: number, columns: number = rows): Matrix {
        const matrix: Matrix = new Matrix(rows, columns)
        matrix.data.fill(1)
        return matrix
    }

    /**
     * The identity matrix: ones on the diagonal, zeros elsewhere.
     * @param size The rows and the columns.
     */
    public identity(size: number): Matrix {
        const matrix: Matrix = new Matrix(size, size)
        for (let i: number = 0; i < size; i++) matrix.data[i * size + i] = 1
        return matrix
    }

    /**
     * A square matrix of values on its diagonal, zeros elsewhere.
     * @param values The diagonal.
     */
    public diagonal(values: VectorValue): Matrix {
        const diagonal: Float64Array = vectorOf(values, 'The diagonal')
        const matrix: Matrix = new Matrix(diagonal.length, diagonal.length)
        diagonal.forEach((value: number, i: number): void => {
            matrix.data[i * diagonal.length + i] = value
        })
        return matrix
    }

    /**
     * A matrix of its rows.
     * @param rows The rows: vectors of the same length.
     */
    public fromRows(rows: VectorValue[]): Matrix {
        return matrixOf(rows.map((row: VectorValue): number[] => Array.from(vectorOf(row, 'A row'))), 'The rows')
    }

    /**
     * A matrix of its columns.
     * @param columns The columns: vectors of the same length.
     */
    public fromColumns(columns: VectorValue[]): Matrix {
        return this.fromRows(columns).transpose()
    }

    /**
     * A matrix of the values of a function of the row and the column of each element (from 0).
     * @param rows The rows.
     * @param columns The columns.
     * @param element The value of an element of a row and a column.
     */
    public fromFunction(rows: number, columns: number, element: (row: number, column: number) => number): Matrix {
        return new Matrix(rows, columns).map((_: number, row: number, column: number): number => element(row, column))
    }

    /**
     * Matrices put together: one below the other (`'vertical'`, of the same number of columns) or side by side
     * (`'horizontal'`, of the same number of rows).
     * @param matrices The matrices (or their rows).
     * @param direction `'vertical'` by default.
     */
    public concat(matrices: MatrixValue[], direction: 'vertical' | 'horizontal' = 'vertical'): Matrix {
        if (direction !== 'vertical' && direction !== 'horizontal') throw new MathArgumentException('Matrices are put together vertically or horizontally')
        const list: Matrix[] = matrices.map((matrix: MatrixValue): Matrix => direction === 'vertical' ? matrixOf(matrix) : matrixOf(matrix).transpose())
        if (!list.length) return new Matrix(0, 0)
        const columns: number = list[0].columns
        const different: Matrix | undefined = list.find((matrix: Matrix): boolean => matrix.columns !== columns)
        if (different) throw new MathArgumentException(`Matrices put together ${direction}ly have the same number of ${direction === 'vertical' ? 'columns' : 'rows'}: ${columns} and ${different.columns}`)
        const rows: number = list.reduce((sum: number, matrix: Matrix): number => sum + matrix.rows, 0)
        const data: Float64Array = new Float64Array(rows * columns)
        let offset: number = 0
        for (const matrix of list) {
            data.set(matrix.data, offset)
            offset += matrix.data.length
        }
        const stacked: Matrix = new Matrix(rows, columns, data)
        return direction === 'vertical' ? stacked : stacked.transpose()
    }

    /**
     * The matrix of a rotation: in the plane (2×2) of an angle, counterclockwise; in space (3×3) of an angle about an
     * axis, counterclockwise looking from its end (the right-hand rule).
     * @param angle The angle, in radians.
     * @param axis The axis of a rotation in space: a vector of 3 elements, not 0.
     */
    public rotation(angle: number, axis?: VectorValue): Matrix {
        const cos: number = Math.cos(angle), sin: number = Math.sin(angle)
        if (axis === undefined) return matrixOf([[cos, -sin], [sin, cos]])
        const u: Float64Array = vectorOf(axis, 'The axis')
        const length: number = Math.hypot(...u)
        if (u.length !== 3 || !(length > 0)) throw new MathArgumentException('The axis of a rotation in space is a vector of 3 elements, not 0')
        const [x, y, z]: number[] = Array.from(u, (value: number): number => value / length)
        const c: number = 1 - cos
        return matrixOf([
            [cos + x * x * c, x * y * c - z * sin, x * z * c + y * sin],
            [y * x * c + z * sin, cos + y * y * c, y * z * c - x * sin],
            [z * x * c - y * sin, z * y * c + x * sin, cos + z * z * c]
        ])
    }

    /**
     * The dot product of two vectors of the same length.
     * @param u A vector.
     * @param v A vector.
     */
    public dot(u: VectorValue, v: VectorValue): number {
        const a: Float64Array = vectorOf(u), b: Float64Array = vectorOf(v)
        sameLength(a, b, 'a dot product')
        let sum: number = 0
        for (let i: number = 0; i < a.length; i++) sum += a[i] * b[i]
        return sum
    }

    /**
     * The cross product of two vectors of 3 elements.
     * @param u A vector.
     * @param v A vector.
     */
    public cross(u: VectorValue, v: VectorValue): Float64Array {
        const a: Float64Array = vectorOf(u), b: Float64Array = vectorOf(v)
        if (a.length !== 3 || b.length !== 3) throw new MathArgumentException('The cross product is of vectors of 3 elements')
        return Float64Array.of(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    }

    /**
     * The outer product of two vectors: the matrix of the products of each element of `u` (its rows) by each one of
     * `v` (its columns).
     * @param u A vector.
     * @param v A vector.
     */
    public outer(u: VectorValue, v: VectorValue): Matrix {
        const a: Float64Array = vectorOf(u), b: Float64Array = vectorOf(v)
        return new Matrix(a.length, b.length).map((_: number, i: number, j: number): number => a[i] * b[j])
    }

    /**
     * The norm of a vector (the Euclidean one by default) or of a matrix (Frobenius's by default).
     * @param value A vector or a matrix.
     * @param kind For a vector, a number p of 1 or more, or `Infinity`; for a matrix, `'fro'`, 1, 2 or `Infinity`.
     */
    public norm(value: MatrixValue | VectorValue, kind?: NormKind): number {
        if (isVector(value)) return this.#vectorNorm(vectorOf(value), kind ?? 2)
        const matrix: Matrix = matrixOf(value)
        if (kind === 2) return this.singularValues(matrix)[0] ?? 0
        return this.#matrixNorm(matrix, kind ?? 'fro')
    }

    /**
     * `norm()` in the threads of the addon: the 2-norm of a large matrix (its largest singular value).
     * @param value A vector or a matrix.
     * @param kind For a vector, a number p of 1 or more, or `Infinity`; for a matrix, `'fro'`, 1, 2 or `Infinity`.
     * @param options Its cancellation, its time limit.
     */
    public async normAsync(value: MatrixValue | VectorValue, kind?: NormKind, options?: AsyncOptions): Promise<number> {
        if (isVector(value) || kind !== 2) return this.norm(value, kind)
        return (await this.singularValuesAsync(value, options))[0] ?? 0
    }

    #vectorNorm(vector: Float64Array, kind: NormKind): number {
        if (kind === Infinity) return vector.reduce((largest: number, value: number): number => Math.max(largest, Math.abs(value)), 0)
        if (kind === 2) return euclidean(vector)
        if (typeof kind !== 'number' || !(kind >= 1)) throw new MathArgumentException('The norm of a vector is of a number p of 1 or more, or Infinity (\'fro\' is for matrices)')
        return vector.reduce((sum: number, value: number): number => sum + Math.abs(value) ** kind, 0) ** (1 / kind)
    }

    #matrixNorm(matrix: Matrix, kind: NormKind): number {
        if (kind === 'fro') return euclidean(matrix.data)
        if (kind !== 1 && kind !== Infinity) throw new MathArgumentException('The norm of a matrix is \'fro\', 1, 2 or Infinity')
        //The largest sum of the absolute values of a column (1) or of a row (Infinity)
        const sums: Float64Array = new Float64Array(kind === 1 ? matrix.columns : matrix.rows)
        for (let i: number = 0; i < matrix.rows; i++) {
            for (let j: number = 0; j < matrix.columns; j++) sums[kind === 1 ? j : i] += Math.abs(matrix.data[i * matrix.columns + j])
        }
        return sums.reduce((largest: number, sum: number): number => Math.max(largest, sum), 0)
    }

    /**
     * The product of two matrices, or of a matrix and a vector (a vector), computed by Eigen.
     * @param a A matrix (or its rows).
     * @param b A matrix (or its rows), or a vector.
     */
    public multiply(a: MatrixValue, b: VectorValue): Float64Array
    public multiply(a: MatrixValue, b: MatrixValue): Matrix
    public multiply(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array
    public multiply(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array {
        return matrixOf(a).mul(b)
    }

    /**
     * `multiply()` in the threads of the addon.
     * @param a A matrix (or its rows).
     * @param b A matrix (or its rows), or a vector.
     * @param options Its cancellation, its time limit.
     */
    public async multiplyAsync(a: MatrixValue, b: VectorValue, options?: AsyncOptions): Promise<Float64Array>
    public async multiplyAsync(a: MatrixValue, b: MatrixValue, options?: AsyncOptions): Promise<Matrix>
    public async multiplyAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array>
    public async multiplyAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array> {
        const right: Operand = operandOf(b, 'The second factor')
        return shapeOf((await this.#runAsync('multiply', [nativeOf(matrixOf(a)), right.native], options))[0], right.vector)
    }

    /**
     * The solution `x` of `a x = b`, of a square matrix `a`: by its LU decomposition with partial pivoting. A singular
     * matrix (a pivot of exactly 0) throws `MathDomainException`.
     * @param a The matrix of the system, square.
     * @param b The right side: a vector (the solution is a vector), or a matrix of one right side by column.
     */
    public solve(a: MatrixValue, b: VectorValue): Float64Array
    public solve(a: MatrixValue, b: MatrixValue): Matrix
    public solve(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array
    public solve(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array {
        const right: Operand = operandOf(b, 'The right side')
        return shapeOf(linalgRun('solve', [nativeOf(matrixOf(a)), right.native])[0], right.vector)
    }

    /**
     * `solve()` in the threads of the addon.
     * @param a The matrix of the system, square.
     * @param b The right side: a vector, or a matrix of one right side by column.
     * @param options Its cancellation, its time limit.
     */
    public async solveAsync(a: MatrixValue, b: VectorValue, options?: AsyncOptions): Promise<Float64Array>
    public async solveAsync(a: MatrixValue, b: MatrixValue, options?: AsyncOptions): Promise<Matrix>
    public async solveAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array>
    public async solveAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array> {
        const right: Operand = operandOf(b, 'The right side')
        return shapeOf((await this.#runAsync('solve', [nativeOf(matrixOf(a)), right.native], options))[0], right.vector)
    }

    /**
     * The solution `x` of `a x = b` of a triangular matrix, by substitution: only its lower triangle (with the
     * diagonal) or its upper one is read. A 0 on the diagonal throws `MathDomainException`.
     * @param a The matrix of the system, square.
     * @param b The right side: a vector, or a matrix of one right side by column.
     * @param triangle The triangle of `a` that is read: `'lower'` or `'upper'`.
     */
    public solveTriangular(a: MatrixValue, b: VectorValue, triangle: 'lower' | 'upper'): Float64Array
    public solveTriangular(a: MatrixValue, b: MatrixValue, triangle: 'lower' | 'upper'): Matrix
    public solveTriangular(a: MatrixValue, b: MatrixValue | VectorValue, triangle: 'lower' | 'upper'): Matrix | Float64Array
    public solveTriangular(a: MatrixValue, b: MatrixValue | VectorValue, triangle: 'lower' | 'upper'): Matrix | Float64Array {
        const right: Operand = operandOf(b, 'The right side')
        return shapeOf(linalgRun('solveTriangular', [nativeOf(matrixOf(a)), right.native], [], triangle)[0], right.vector)
    }

    /**
     * The least-squares solution `x` of `a x = b`, of the least norm: the one of NumPy's `lstsq`, by the singular values
     * of `a` above `max(rows, columns)` times the machine epsilon times the largest one. It solves systems of more
     * equations than unknowns, of fewer, and singular ones.
     * @param a The matrix of the system, of any size.
     * @param b The right side: a vector, or a matrix of one right side by column.
     */
    public leastSquares(a: MatrixValue, b: VectorValue): Float64Array
    public leastSquares(a: MatrixValue, b: MatrixValue): Matrix
    public leastSquares(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array
    public leastSquares(a: MatrixValue, b: MatrixValue | VectorValue): Matrix | Float64Array {
        const right: Operand = operandOf(b, 'The right side')
        return shapeOf(linalgRun('leastSquares', [nativeOf(matrixOf(a)), right.native])[0], right.vector)
    }

    /**
     * `leastSquares()` in the threads of the addon.
     * @param a The matrix of the system, of any size.
     * @param b The right side: a vector, or a matrix of one right side by column.
     * @param options Its cancellation, its time limit.
     */
    public async leastSquaresAsync(a: MatrixValue, b: VectorValue, options?: AsyncOptions): Promise<Float64Array>
    public async leastSquaresAsync(a: MatrixValue, b: MatrixValue, options?: AsyncOptions): Promise<Matrix>
    public async leastSquaresAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array>
    public async leastSquaresAsync(a: MatrixValue, b: MatrixValue | VectorValue, options?: AsyncOptions): Promise<Matrix | Float64Array> {
        const right: Operand = operandOf(b, 'The right side')
        return shapeOf((await this.#runAsync('leastSquares', [nativeOf(matrixOf(a)), right.native], options))[0], right.vector)
    }

    /**
     * The inverse of a square matrix, by its LU decomposition with partial pivoting. A singular matrix (a pivot of
     * exactly 0) throws `MathDomainException`.
     * @param a The matrix.
     */
    public inverse(a: MatrixValue): Matrix {
        return matrixFrom(linalgRun('inverse', [nativeOf(matrixOf(a))])[0])
    }

    /**
     * `inverse()` in the threads of the addon.
     * @param a The matrix.
     * @param options Its cancellation, its time limit.
     */
    public async inverseAsync(a: MatrixValue, options?: AsyncOptions): Promise<Matrix> {
        return matrixFrom((await this.#runAsync('inverse', [nativeOf(matrixOf(a))], options))[0])
    }

    /**
     * The determinant of a square matrix, by its LU decomposition: 0 for a singular one, 1 for a matrix of no rows.
     * @param a The matrix.
     */
    public determinant(a: MatrixValue): number {
        return linalgRun('determinant', [nativeOf(matrixOf(a))])[0][2][0]
    }

    /**
     * `determinant()` in the threads of the addon.
     * @param a The matrix.
     * @param options Its cancellation, its time limit.
     */
    public async determinantAsync(a: MatrixValue, options?: AsyncOptions): Promise<number> {
        return (await this.#runAsync('determinant', [nativeOf(matrixOf(a))], options))[0][2][0]
    }

    /**
     * The singular values of a matrix, from the largest: `min(rows, columns)` of them.
     * @param a The matrix.
     */
    public singularValues(a: MatrixValue): Float64Array {
        return linalgRun('singularValues', [nativeOf(matrixOf(a))])[0][2]
    }

    /**
     * `singularValues()` in the threads of the addon.
     * @param a The matrix.
     * @param options Its cancellation, its time limit.
     */
    public async singularValuesAsync(a: MatrixValue, options?: AsyncOptions): Promise<Float64Array> {
        return (await this.#runAsync('singularValues', [nativeOf(matrixOf(a))], options))[0][2]
    }

    /**
     * The rank of a matrix: the number of its singular values above a tolerance, by default the largest one times
     * `max(rows, columns)` times the machine epsilon (NumPy's `matrix_rank`).
     * @param a The matrix.
     * @param tolerance The singular values at or below it are 0.
     */
    public rank(a: MatrixValue, tolerance?: number): number {
        const matrix: Matrix = matrixOf(a)
        return rankOf(this.singularValues(matrix), matrix.rows, matrix.columns, tolerance)
    }

    /**
     * `rank()` in the threads of the addon.
     * @param a The matrix.
     * @param tolerance The singular values at or below it are 0.
     * @param options Its cancellation, its time limit.
     */
    public async rankAsync(a: MatrixValue, tolerance?: number, options?: AsyncOptions): Promise<number> {
        const matrix: Matrix = matrixOf(a)
        return rankOf(await this.singularValuesAsync(matrix, options), matrix.rows, matrix.columns, tolerance)
    }

    /**
     * The condition number of a matrix in the 2-norm: its largest singular value over its smallest one (`Infinity`
     * when that one is 0). The digits a solution of a system loses are about its logarithm in base 10.
     * @param a The matrix.
     */
    public condition(a: MatrixValue): number {
        return conditionOf(this.singularValues(a))
    }

    /**
     * `condition()` in the threads of the addon.
     * @param a The matrix.
     * @param options Its cancellation, its time limit.
     */
    public async conditionAsync(a: MatrixValue, options?: AsyncOptions): Promise<number> {
        return conditionOf(await this.singularValuesAsync(a, options))
    }
}
