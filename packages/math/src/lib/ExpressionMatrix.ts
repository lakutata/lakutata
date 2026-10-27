import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {Expression, handleOf, parsedOf, type Value} from './Expression.js'
import {Matrix} from './Matrix.js'
import {type Handle, type NativeMatrixOfExpressions} from './Native.js'

/**
 * What is given where a matrix of expressions is expected: a matrix of expressions, a matrix of numbers (each the
 * decimal it prints as), its rows (expressions, numbers or formulas), or a formula of a matrix (`[1, x; x^2, 2]`)
 */
export type ExpressionMatrixValue = ExpressionMatrix | Matrix | readonly (readonly Value[])[] | string

/**
 * The reduced row echelon form of a matrix
 */
export interface RowEchelonForm {
    /**
     * The matrix in its reduced row echelon form.
     */
    matrix: ExpressionMatrix
    /**
     * The columns of its pivots, from 0.
     */
    pivots: number[]
}

/**
 * An eigenvalue, its multiplicity, and the basis of its eigenvectors
 */
export interface Eigenvector {
    /**
     * The eigenvalue.
     */
    value: Expression
    /**
     * Its algebraic multiplicity: the multiplicity of the root of the characteristic polynomial.
     */
    multiplicity: number
    /**
     * A basis of its eigenvectors (columns): as many as its geometric multiplicity.
     */
    vectors: ExpressionMatrix[]
}

interface NativeMatrixResult {
    matrix?: NativeMatrixOfExpressions
    expression?: Handle
    matrices: NativeMatrixOfExpressions[]
    expressions: Handle[]
    numbers: number[]
    text: string
}

/**
 * A matrix of expressions: of its rows (`[[1, 'x'], ['x^2', 2]]`), of a formula (`[1, x; x^2, 2]`), or of a matrix of
 * numbers. Like an expression, it does not change: each operation gives a new one (`with()` gives a matrix with an
 * element replaced; `Matrix.set()` changes a matrix of numbers).
 *
 * Its linear algebra is exact: the determinant and the characteristic polynomial by Berkowitz's algorithm (without
 * divisions), the inverse and the solutions of a matrix with variables by its adjugate and its determinant, those of a
 * matrix of numbers by an elimination, the reduced row echelon form by an elimination (normalized at its end for a
 * matrix with variables). An element counts as 0 when it is 0 once expanded; when, without variables, its decimals
 * cannot tell it from 0 (as `toDecimal()` decides, 640 digits beyond); or when, with variables, it is 0 at every value
 * of them (checked exactly at two values). As in SymPy, a pivot that is 0 only for some values of the variables counts
 * as not 0 (the generic case).
 * @example
 * ```typescript
 * import {expressionMatrix, type ExpressionMatrix} from '@lakutata/math'
 *
 * const m: ExpressionMatrix = expressionMatrix([['a', 'b'], ['c', 'd']])
 * console.log(m.determinant().toString())                   //a*d - b*c
 * console.log(m.inverse().toString())                       //[d/(a*d - b*c), -b/(a*d - b*c); -c/(a*d - b*c), a/(a*d - b*c)]
 * console.log(expressionMatrix('[2, 1; 1, 2]').eigenvalues().map(({value}) => value.toString())) //['1', '3']
 * ```
 */
export class ExpressionMatrix {

    /**
     * A matrix of expressions of the addon in a context. Made by `expressionMatrix()`, `parse()` and the operations.
     * @param context The context: its definitions, its settings.
     * @param handle The matrix of the addon.
     * @param rows The number of its rows.
     * @param columns The number of its columns.
     */
    constructor(protected readonly context: Context, public readonly handle: Handle, public readonly rows: number, public readonly columns: number) {
    }

    #run(operation: string, matrices: ExpressionMatrix[] = [], expressions: Handle[] = [], numbers: number[] = [], names: string[] = []): NativeMatrixResult {
        return this.context.run<NativeMatrixResult>('matrix', [operation, [this.handle, ...matrices.map((matrix: ExpressionMatrix): Handle => matrix.handle)], expressions, numbers, names])
    }

    async #runAsync(operation: string, options: AsyncOptions | undefined, matrices: ExpressionMatrix[] = []): Promise<NativeMatrixResult> {
        return await this.context.runAsync<NativeMatrixResult>('matrix', [operation, [this.handle, ...matrices.map((matrix: ExpressionMatrix): Handle => matrix.handle)], [], [], []], options)
    }

    #matrix(native: NativeMatrixOfExpressions): ExpressionMatrix {
        return new ExpressionMatrix(this.context, native.matrix, native.rows, native.columns)
    }

    #other(value: ExpressionMatrixValue): ExpressionMatrix {
        return expressionMatrixOf(this.context, value)
    }

    /**
     * The element of a row and a column, from 0.
     * @param row The row.
     * @param column The column.
     */
    public get(row: number, column: number): Expression {
        return new Expression(this.context, this.#run('get', [], [], [row, column]).expression!)
    }

    /**
     * The elements, row by row.
     */
    public toArray(): Expression[][] {
        const elements: Handle[] = this.#run('elements').expressions
        return Array.from({length: this.rows}, (_: unknown, i: number): Expression[] => elements.slice(i * this.columns, (i + 1) * this.columns).map((handle: Handle): Expression => new Expression(this.context, handle)))
    }

    /**
     * A matrix with an element replaced (as `Array.prototype.with()`).
     * @param row The row, from 0.
     * @param column The column, from 0.
     * @param value The new element.
     */
    public with(row: number, column: number, value: Value): ExpressionMatrix {
        return this.#matrix(this.#run('with', [], [handleOf(this.context, value)], [row, column]).matrix!)
    }

    /**
     * A row, as a matrix of one row.
     * @param row The row, from 0.
     */
    public row(row: number): ExpressionMatrix {
        return this.submatrix(row, 0, 1, this.columns)
    }

    /**
     * A column, as a matrix of one column.
     * @param column The column, from 0.
     */
    public column(column: number): ExpressionMatrix {
        return this.submatrix(0, column, this.rows, 1)
    }

    /**
     * The matrix of some rows and some columns.
     * @param row The first row, from 0.
     * @param column The first column, from 0.
     * @param rows The number of rows.
     * @param columns The number of columns.
     */
    public submatrix(row: number, column: number, rows: number, columns: number): ExpressionMatrix {
        return this.#matrix(this.#run('submatrix', [], [], [row, column, rows, columns]).matrix!)
    }

    /**
     * The transpose.
     */
    public transpose(): ExpressionMatrix {
        return this.#matrix(this.#run('transpose').matrix!)
    }

    /**
     * The opposite.
     */
    public neg(): ExpressionMatrix {
        return this.#matrix(this.#run('neg').matrix!)
    }

    /**
     * The sum with a matrix of the same dimensions (a number is not added to a matrix: add it times the identity).
     * @param other The other matrix.
     */
    public add(other: ExpressionMatrixValue): ExpressionMatrix {
        return this.#matrix(this.#run('add', [this.#other(other)]).matrix!)
    }

    /**
     * The difference with a matrix of the same dimensions.
     * @param other The other matrix.
     */
    public sub(other: ExpressionMatrixValue): ExpressionMatrix {
        return this.#matrix(this.#run('sub', [this.#other(other)]).matrix!)
    }

    /**
     * The product by a matrix (its rows as many as the columns of this one), or by an expression.
     * @param other The matrix, or the expression.
     */
    public mul(other: ExpressionMatrixValue | Value): ExpressionMatrix {
        if (other instanceof ExpressionMatrix || other instanceof Matrix || Array.isArray(other) || (typeof other === 'string' && parsedOf(this.context, other).kind === 'matrix')) {
            return this.#matrix(this.#run('mul', [this.#other(other as ExpressionMatrixValue)]).matrix!)
        }
        return this.#matrix(this.#run('scale', [], [handleOf(this.context, other as Value)]).matrix!)
    }

    /**
     * The quotient by an expression that is not 0 (to divide by a matrix, multiply by its `inverse()`).
     * @param divisor The expression.
     */
    public div(divisor: Value): ExpressionMatrix {
        return this.#matrix(this.#run('divide', [], [handleOf(this.context, divisor)]).matrix!)
    }

    /**
     * The product element by element with a matrix of the same dimensions (Hadamard's product).
     * @param other The other matrix.
     */
    public multiplyElements(other: ExpressionMatrixValue): ExpressionMatrix {
        return this.#matrix(this.#run('multiplyElements', [this.#other(other)]).matrix!)
    }

    /**
     * A square matrix raised to an integer: the identity for 0; a negative one gives a power of the inverse.
     * @param exponent The exponent, an integer from -10^6 to 10^6.
     */
    public pow(exponent: number | bigint): ExpressionMatrix {
        if (typeof exponent !== 'bigint' && !Number.isSafeInteger(exponent)) throw new MathArgumentException('The exponent of a matrix is an integer')
        return this.#matrix(this.#run('pow', [], [handleOf(this.context, BigInt(exponent))]).matrix!)
    }

    /**
     * The trace of a square matrix: the sum of its diagonal.
     */
    public trace(): Expression {
        return new Expression(this.context, this.#run('trace').expression!)
    }

    /**
     * The determinant of a square matrix, expanded.
     */
    public determinant(): Expression {
        return new Expression(this.context, this.#run('determinant').expression!)
    }

    /**
     * `determinant()` in the threads of the addon.
     * @param options Its cancellation, its time limit.
     */
    public async determinantAsync(options?: AsyncOptions): Promise<Expression> {
        return new Expression(this.context, (await this.#runAsync('determinant', options)).expression!)
    }

    /**
     * The inverse of a square matrix that is not singular (`MathDomainException` otherwise).
     */
    public inverse(): ExpressionMatrix {
        return this.#matrix(this.#run('inverse').matrix!)
    }

    /**
     * `inverse()` in the threads of the addon.
     * @param options Its cancellation, its time limit.
     */
    public async inverseAsync(options?: AsyncOptions): Promise<ExpressionMatrix> {
        return this.#matrix((await this.#runAsync('inverse', options)).matrix!)
    }

    //A right side: a matrix, or a vector of values as a column
    #side(b: ExpressionMatrixValue | readonly Value[]): ExpressionMatrix {
        if (Array.isArray(b) && b.length > 0 && !Array.isArray(b[0])) return expressionMatrixOf(this.context, (b as readonly Value[]).map((value: Value): Value[] => [value]))
        return this.#other(b as ExpressionMatrixValue)
    }

    /**
     * The solution X of A X = B, A this square matrix, not singular (`MathDomainException` otherwise): a column for a
     * vector B (an array of values), a matrix for a matrix B. Other systems: `rref()` of the augmented matrix, or the
     * `solve()` function of the package, of the equations.
     * @param b The right side.
     */
    public solve(b: ExpressionMatrixValue | readonly Value[]): ExpressionMatrix {
        return this.#matrix(this.#run('solve', [this.#side(b)]).matrix!)
    }

    /**
     * `solve()` in the threads of the addon.
     * @param b The right side.
     * @param options Its cancellation, its time limit.
     */
    public async solveAsync(b: ExpressionMatrixValue | readonly Value[], options?: AsyncOptions): Promise<ExpressionMatrix> {
        return this.#matrix((await this.#runAsync('solve', options, [this.#side(b)])).matrix!)
    }

    /**
     * The reduced row echelon form, and the columns of its pivots.
     */
    public rref(): RowEchelonForm {
        const result: NativeMatrixResult = this.#run('rref')
        return {matrix: this.#matrix(result.matrix!), pivots: result.numbers}
    }

    /**
     * The rank: the number of pivots of the reduced row echelon form.
     */
    public rank(): number {
        return this.#run('rank').numbers[0]
    }

    /**
     * A basis of the null space: the vectors X with A X = 0, one for each column without a pivot.
     */
    public nullspace(): ExpressionMatrix[] {
        return this.#run('nullspace').matrices.map((native: NativeMatrixOfExpressions): ExpressionMatrix => this.#matrix(native))
    }

    /**
     * The characteristic polynomial `det(x I - A)` of a square matrix, expanded.
     * @param variable Its variable, not one of the matrix: `lambda` by default.
     */
    public characteristicPolynomial(variable: string = 'lambda'): Expression {
        return new Expression(this.context, this.#run('characteristicPolynomial', [], [], [], [variable]).expression!)
    }

    /**
     * The eigenvalues of a square matrix and their algebraic multiplicities: the roots of its characteristic
     * polynomial, the elements of the diagonal that are roots and the rational roots first, then the roots of what is
     * left, exact to degree 4; others throw `MathNotSupportedException`, and `linalg.eigen()` gives them as numbers.
     */
    public eigenvalues(): {value: Expression, multiplicity: number}[] {
        const result: NativeMatrixResult = this.#run('eigenvalues')
        return result.expressions.map((handle: Handle, i: number): {value: Expression, multiplicity: number} => ({value: new Expression(this.context, handle), multiplicity: result.numbers[i]}))
    }

    #eigenvectors(result: NativeMatrixResult): Eigenvector[] {
        const vectors: Eigenvector[] = []
        let next: number = 0
        result.expressions.forEach((handle: Handle, i: number): void => {
            const count: number = result.numbers[2 * i + 1]
            vectors.push({value: new Expression(this.context, handle), multiplicity: result.numbers[2 * i], vectors: result.matrices.slice(next, next + count).map((native: NativeMatrixOfExpressions): ExpressionMatrix => this.#matrix(native))})
            next += count
        })
        return vectors
    }

    /**
     * The eigenvalues, their multiplicities and the bases of their eigenvectors: the null spaces of `A - value I`.
     */
    public eigenvectors(): Eigenvector[] {
        return this.#eigenvectors(this.#run('eigenvectors'))
    }

    /**
     * `eigenvectors()` in the threads of the addon.
     * @param options Its cancellation, its time limit.
     */
    public async eigenvectorsAsync(options?: AsyncOptions): Promise<Eigenvector[]> {
        return this.#eigenvectors(await this.#runAsync('eigenvectors', options))
    }

    /**
     * The derivative of each element by a variable.
     * @param variable The variable.
     * @param times The number of derivatives: 1 by default.
     */
    public diff(variable: string, times: number = 1): ExpressionMatrix {
        return this.#matrix(this.#run('diff', [], [], [times], [variable]).matrix!)
    }

    /**
     * The matrix with variables replaced by values (expressions, numbers or formulas).
     * @param values The values, by the names of the variables.
     */
    public substitute(values: Record<string, Value>): ExpressionMatrix {
        const names: string[] = Object.keys(values)
        return this.#matrix(this.#run('substitute', [], names.map((name: string): Handle => handleOf(this.context, values[name])), [], names).matrix!)
    }

    /**
     * Each element expanded.
     */
    public expand(): ExpressionMatrix {
        return this.#matrix(this.#run('expand').matrix!)
    }

    /**
     * Each element simplified.
     */
    public simplify(): ExpressionMatrix {
        return this.#matrix(this.#run('simplify').matrix!)
    }

    /**
     * Whether the matrix equals another one: the same dimensions, each element equal (their difference expanded, or
     * simplified, is 0).
     * @param other The other matrix.
     */
    public equals(other: ExpressionMatrixValue): boolean {
        return this.#run('equals', [this.#other(other)]).numbers[0] === 1
    }

    /**
     * The matrix of numbers of the values of the elements (without variables: substitute them first).
     */
    public toMatrix(): Matrix {
        return new Matrix(this.rows, this.columns, Float64Array.from(this.#run('toNumbers').numbers))
    }

    /**
     * The matrix as a formula: `[1, x; x^2, 2]`, its rows separated by `;`. `parse()` reads it back.
     */
    public toString(): string {
        return this.#run('text').text
    }

    /**
     * The matrix in LaTeX: a `bmatrix`.
     */
    public toTeX(): string {
        return this.#run('tex').text
    }
}

/**
 * The matrix of expressions of a value: a matrix of expressions, a matrix of numbers, rows, a formula of a matrix
 * @param context
 * @param value
 */
export function expressionMatrixOf(context: Context, value: ExpressionMatrixValue): ExpressionMatrix {
    if (value instanceof ExpressionMatrix) return value
    const native = (operation: string, expressions: Handle[], numbers: number[]): ExpressionMatrix => {
        const result = context.run<NativeMatrixResult>('matrix', [operation, [], expressions, numbers, []]).matrix!
        return new ExpressionMatrix(context, result.matrix, result.rows, result.columns)
    }
    if (value instanceof Matrix) return native('fromNumbers', [], [value.rows, value.columns, ...value.data])
    if (typeof value === 'string') {
        const parsed = parsedOf(context, value)
        if (parsed.kind !== 'matrix') throw new MathArgumentException(`Not a matrix: ${value}`)
        return new ExpressionMatrix(context, parsed.matrix!.matrix, parsed.matrix!.rows, parsed.matrix!.columns)
    }
    if (!Array.isArray(value) || value.length === 0 || !value.every((row: unknown): boolean => Array.isArray(row) && row.length === (value[0] as unknown[]).length) || (value[0] as unknown[]).length === 0) {
        throw new MathArgumentException('A matrix of expressions is given by its rows, of the same length, with at least one element')
    }
    const handles: Handle[] = value.flatMap((row: readonly Value[]): Handle[] => row.map((element: Value): Handle => handleOf(context, element)))
    return native('fromRows', handles, [value.length, value[0].length])
}
