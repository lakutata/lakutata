import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {nativeCall} from './Native.js'

/**
 * A value given where a matrix is expected: a matrix, or its rows (`[[1, 2], [3, 4]]`; `[]` is a matrix of no rows and
 * no columns, `[[]]` one of a row and no columns)
 */
export type MatrixValue = Matrix | number[][]

/**
 * A value given where a vector is expected: a `Float64Array`, or an array of numbers (`[]` is a vector of no elements,
 * where a vector or a matrix may be given)
 */
export type VectorValue = Float64Array | number[]

/**
 * A matrix as the addon reads and gives it: its rows, its columns, its elements row by row
 */
export type NativeMatrix = [number, number, Float64Array]

function dimension(value: number, what: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw new MathArgumentException(`${what} is an integer of 0 or more`)
    return value
}

/**
 * The matrix of a value: a matrix itself, or one made of its rows
 * @param value
 * @param what The name of the value in the errors.
 */
export function matrixOf(value: MatrixValue, what: string = 'The matrix'): Matrix {
    if (value instanceof Matrix) return value
    if (!Array.isArray(value) || !value.every((row: unknown): boolean => Array.isArray(row))) throw new MathArgumentException(`${what} is a Matrix or an array of rows`)
    const columns: number = value.length ? value[0].length : 0
    const data: Float64Array = new Float64Array(value.length * columns)
    value.forEach((row: number[], i: number): void => {
        if (row.length !== columns) throw new MathArgumentException(`${what} has rows of different lengths (${columns} and ${row.length})`)
        row.forEach((element: number, j: number): void => {
            if (typeof element !== 'number') throw new MathArgumentException(`${what} has an element that is not a number`)
            data[i * columns + j] = element
        })
    })
    return new Matrix(value.length, columns, data)
}

/**
 * The elements of a vector as a `Float64Array` (the array itself when it is one)
 * @param value
 * @param what The name of the value in the errors.
 */
export function vectorOf(value: VectorValue, what: string = 'The vector'): Float64Array {
    if (value instanceof Float64Array) return value
    if (!Array.isArray(value) || !value.every((element: unknown): boolean => typeof element === 'number')) throw new MathArgumentException(`${what} is a Float64Array or an array of numbers`)
    return Float64Array.from(value)
}

/**
 * Whether a value given is a vector (a `Float64Array`, or an array of numbers) rather than a matrix
 * @param value
 */
export function isVector(value: unknown): value is VectorValue {
    return value instanceof Float64Array || (Array.isArray(value) && value.every((element: unknown): boolean => typeof element === 'number'))
}

/**
 * A matrix as the addon reads it
 * @param matrix
 */
export function nativeOf(matrix: Matrix): NativeMatrix {
    return [matrix.rows, matrix.columns, matrix.data]
}

/**
 * A vector as the addon reads it: a matrix of one column
 * @param vector
 */
export function nativeColumnOf(vector: Float64Array): NativeMatrix {
    return [vector.length, 1, vector]
}

/**
 * A matrix of the addon
 * @param result
 */
export function matrixFrom(result: NativeMatrix): Matrix {
    return new Matrix(result[0], result[1], result[2])
}

/**
 * An operation of the linear algebra in the thread of JavaScript
 * @param operation
 * @param matrices
 * @param numbers
 * @param option
 */
export function linalgRun(operation: string, matrices: NativeMatrix[], numbers: number[] = [], option: string = ''): NativeMatrix[] {
    return nativeCall((native) => native.run('linalg', [operation, matrices, numbers, option])) as NativeMatrix[]
}

/**
 * A matrix of numbers (doubles): its elements in a `Float64Array`, row by row, which the addon reads in place. Its
 * operations never change it: they give new matrices; `set()` and the elements of `data` are the ways to fill one.
 *
 * Its products (`mul()`) are computed by Eigen; the operations of one element at a time (`add()`, `transpose()`,
 * `map()`…) in JavaScript. A matrix times a vector (a `Float64Array`, or an array of numbers) is a vector. The
 * decompositions, the inverse and the solutions of linear systems are in `math.linalg`.
 * @example
 * ```typescript
 * import {math, Matrix} from '@lakutata/math'
 *
 * const a: Matrix = math.matrix([[4, 1], [2, 3]])
 * a.mul(a).toString()                               //[18, 7; 14, 11]
 * a.mul([1, 1])                                     //Float64Array [5, 5]
 * a.transpose().add(1).toArray()                    //[[5, 3], [2, 4]]
 * math.linalg.inverse(a).toString()                 //[0.3, -0.1; -0.2, 0.4]
 * ```
 */
export class Matrix {

    /**
     * The elements, row by row: the element of row i and column j is `data[i * columns + j]`.
     */
    public readonly data: Float64Array

    /**
     * A matrix of zeros, or of elements given.
     * @param rows The rows, an integer of 0 or more.
     * @param columns The columns, an integer of 0 or more.
     * @param data Its elements, row by row: `rows * columns` of them, used as they are (not copied). Zeros by default.
     */
    constructor(public readonly rows: number, public readonly columns: number, data?: Float64Array) {
        dimension(rows, 'The number of rows')
        dimension(columns, 'The number of columns')
        if (data !== undefined && !(data instanceof Float64Array)) throw new MathArgumentException('The elements of a matrix are a Float64Array')
        if (data !== undefined && data.length !== rows * columns) throw new MathArgumentException(`A matrix of ${rows}×${columns} has ${rows * columns} elements, not ${data.length}`)
        this.data = data ?? new Float64Array(rows * columns)
    }

    #index(row: number, column: number): number {
        if (!Number.isInteger(row) || row < 0 || row >= this.rows) throw new MathArgumentException(`The row ${row} is not one of the ${this.rows} rows`)
        if (!Number.isInteger(column) || column < 0 || column >= this.columns) throw new MathArgumentException(`The column ${column} is not one of the ${this.columns} columns`)
        return row * this.columns + column
    }

    #sameSize(other: Matrix, operation: string): void {
        if (other.rows !== this.rows || other.columns !== this.columns) {
            throw new MathArgumentException(`The matrices of ${operation} differ in size: ${this.rows}×${this.columns} and ${other.rows}×${other.columns}`)
        }
    }

    #elementwise(other: MatrixValue, operation: string, apply: (a: number, b: number) => number): Matrix {
        const matrix: Matrix = matrixOf(other)
        this.#sameSize(matrix, operation)
        const data: Float64Array = new Float64Array(this.data.length)
        for (let i: number = 0; i < data.length; i++) data[i] = apply(this.data[i], matrix.data[i])
        return new Matrix(this.rows, this.columns, data)
    }

    #scalar(apply: (a: number) => number): Matrix {
        const data: Float64Array = new Float64Array(this.data.length)
        for (let i: number = 0; i < data.length; i++) data[i] = apply(this.data[i])
        return new Matrix(this.rows, this.columns, data)
    }

    /**
     * The element of a row and a column (from 0).
     * @param row The row.
     * @param column The column.
     */
    public get(row: number, column: number): number {
        return this.data[this.#index(row, column)]
    }

    /**
     * Set the element of a row and a column (from 0): the matrix changes.
     * @param row The row.
     * @param column The column.
     * @param value The value.
     */
    public set(row: number, column: number, value: number): this {
        if (typeof value !== 'number') throw new MathArgumentException('The element of a matrix is a number')
        this.data[this.#index(row, column)] = value
        return this
    }

    /**
     * The elements of a row (from 0), copied.
     * @param row The row.
     */
    public row(row: number): Float64Array {
        if (!Number.isInteger(row) || row < 0 || row >= this.rows) throw new MathArgumentException(`The row ${row} is not one of the ${this.rows} rows`)
        return this.data.slice(row * this.columns, (row + 1) * this.columns)
    }

    /**
     * The elements of a column (from 0), copied.
     * @param column The column.
     */
    public column(column: number): Float64Array {
        if (!Number.isInteger(column) || column < 0 || column >= this.columns) throw new MathArgumentException(`The column ${column} is not one of the ${this.columns} columns`)
        const values: Float64Array = new Float64Array(this.rows)
        for (let i: number = 0; i < this.rows; i++) values[i] = this.data[i * this.columns + column]
        return values
    }

    /**
     * The elements of the diagonal: of the rows and columns of the same index.
     */
    public diagonal(): Float64Array {
        const values: Float64Array = new Float64Array(Math.min(this.rows, this.columns))
        for (let i: number = 0; i < values.length; i++) values[i] = this.data[i * this.columns + i]
        return values
    }

    /**
     * The rows from `rowStart` to `rowEnd` (excluded) and the columns from `columnStart` to `columnEnd` (excluded).
     * @param rowStart The first row: 0 by default.
     * @param rowEnd The row after the last: all of them by default.
     * @param columnStart The first column: 0 by default.
     * @param columnEnd The column after the last: all of them by default.
     */
    public submatrix(rowStart: number = 0, rowEnd: number = this.rows, columnStart: number = 0, columnEnd: number = this.columns): Matrix {
        for (const [start, end, size, what] of [[rowStart, rowEnd, this.rows, 'rows'], [columnStart, columnEnd, this.columns, 'columns']] as [number, number, number, string][]) {
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > size || start > end) throw new MathArgumentException(`The ${what} from ${start} to ${end} are not within the ${size} ${what}`)
        }
        const rows: number = rowEnd - rowStart, columns: number = columnEnd - columnStart
        const data: Float64Array = new Float64Array(rows * columns)
        for (let i: number = 0; i < rows; i++) data.set(this.data.subarray((rowStart + i) * this.columns + columnStart, (rowStart + i) * this.columns + columnEnd), i * columns)
        return new Matrix(rows, columns, data)
    }

    /**
     * The same elements, row by row, in other dimensions of the same number of elements.
     * @param rows The rows.
     * @param columns The columns.
     */
    public reshape(rows: number, columns: number): Matrix {
        if (dimension(rows, 'The number of rows') * dimension(columns, 'The number of columns') !== this.data.length) {
            throw new MathArgumentException(`A matrix of ${this.data.length} elements cannot be ${rows}×${columns}`)
        }
        return new Matrix(rows, columns, this.data.slice())
    }

    /**
     * The transpose: the rows become the columns.
     */
    public transpose(): Matrix {
        const data: Float64Array = new Float64Array(this.data.length)
        for (let i: number = 0; i < this.rows; i++) {
            for (let j: number = 0; j < this.columns; j++) data[j * this.rows + i] = this.data[i * this.columns + j]
        }
        return new Matrix(this.columns, this.rows, data)
    }

    /**
     * The sum of the matrix and another one of its size, or a number added to each element.
     * @param other A matrix (or its rows), or a number.
     */
    public add(other: MatrixValue | number): Matrix {
        if (typeof other === 'number') return this.#scalar((a: number): number => a + other)
        return this.#elementwise(other, 'a sum', (a: number, b: number): number => a + b)
    }

    /**
     * The difference of the matrix and another one of its size, or a number subtracted from each element.
     * @param other A matrix (or its rows), or a number.
     */
    public sub(other: MatrixValue | number): Matrix {
        if (typeof other === 'number') return this.#scalar((a: number): number => a - other)
        return this.#elementwise(other, 'a difference', (a: number, b: number): number => a - b)
    }

    /**
     * The product of the matrix and a matrix (computed by Eigen), a vector (a vector), or a number (each element
     * times it). The products of large matrices take long: `math.linalg.multiplyAsync()` computes them in the threads
     * of the addon.
     * @param other A matrix (or its rows), a vector, or a number.
     */
    public mul(other: number | MatrixValue): Matrix
    public mul(other: VectorValue): Float64Array
    public mul(other: number | MatrixValue | VectorValue): Matrix | Float64Array
    public mul(other: number | MatrixValue | VectorValue): Matrix | Float64Array {
        if (typeof other === 'number') return this.#scalar((a: number): number => a * other)
        if (isVector(other)) return linalgRun('multiply', [nativeOf(this), nativeColumnOf(vectorOf(other))])[0][2]
        return matrixFrom(linalgRun('multiply', [nativeOf(this), nativeOf(matrixOf(other))])[0])
    }

    /**
     * Each element divided by a number.
     * @param divisor The number.
     */
    public div(divisor: number): Matrix {
        if (typeof divisor !== 'number') throw new MathArgumentException('A matrix is divided by a number: for a matrix, multiply by its inverse (math.linalg.inverse) or solve a system (math.linalg.solve)')
        return this.#scalar((a: number): number => a / divisor)
    }

    /**
     * The opposite: each element negated.
     */
    public neg(): Matrix {
        return this.#scalar((a: number): number => -a)
    }

    /**
     * The products of the elements of the same place in two matrices of the same size.
     * @param other A matrix (or its rows).
     */
    public multiplyElements(other: MatrixValue): Matrix {
        return this.#elementwise(other, 'a product of elements', (a: number, b: number): number => a * b)
    }

    /**
     * The quotients of the elements of the same place in two matrices of the same size.
     * @param other A matrix (or its rows).
     */
    public divideElements(other: MatrixValue): Matrix {
        return this.#elementwise(other, 'a quotient of elements', (a: number, b: number): number => a / b)
    }

    /**
     * Each element to a power (not the power of the matrix: that is `mul()` again, or `math.linalg.exponential()`).
     * @param exponent The power.
     */
    public powElements(exponent: number): Matrix {
        if (typeof exponent !== 'number') throw new MathArgumentException('The exponent is a number')
        return this.#scalar((a: number): number => a ** exponent)
    }

    /**
     * A matrix of the values of a function of each element.
     * @param transform The function of an element, its row and its column.
     */
    public map(transform: (value: number, row: number, column: number) => number): Matrix {
        const data: Float64Array = new Float64Array(this.data.length)
        for (let i: number = 0; i < this.rows; i++) {
            for (let j: number = 0; j < this.columns; j++) data[i * this.columns + j] = transform(this.data[i * this.columns + j], i, j)
        }
        return new Matrix(this.rows, this.columns, data)
    }

    /**
     * The sum of the elements of the diagonal, of a square matrix.
     */
    public trace(): number {
        if (this.rows !== this.columns) throw new MathArgumentException(`The trace is of a square matrix, not of ${this.rows}×${this.columns}`)
        let sum: number = 0
        for (let i: number = 0; i < this.rows; i++) sum += this.data[i * this.columns + i]
        return sum
    }

    /**
     * The Kronecker product: each element times the other matrix, as a block.
     * @param other A matrix (or its rows).
     */
    public kron(other: MatrixValue): Matrix {
        const b: Matrix = matrixOf(other)
        const rows: number = this.rows * b.rows, columns: number = this.columns * b.columns
        const data: Float64Array = new Float64Array(rows * columns)
        for (let i: number = 0; i < this.rows; i++) {
            for (let j: number = 0; j < this.columns; j++) {
                const a: number = this.data[i * this.columns + j]
                for (let k: number = 0; k < b.rows; k++) {
                    for (let l: number = 0; l < b.columns; l++) data[(i * b.rows + k) * columns + j * b.columns + l] = a * b.data[k * b.columns + l]
                }
            }
        }
        return new Matrix(rows, columns, data)
    }

    /**
     * Whether a matrix has the same size and elements: equal, or apart by at most a tolerance each.
     * @param other A matrix (or its rows).
     * @param tolerance The largest difference of two elements: 0 by default.
     */
    public equals(other: MatrixValue, tolerance: number = 0): boolean {
        const matrix: Matrix = matrixOf(other)
        if (matrix.rows !== this.rows || matrix.columns !== this.columns) return false
        for (let i: number = 0; i < this.data.length; i++) {
            if (!(Math.abs(this.data[i] - matrix.data[i]) <= tolerance) && this.data[i] !== matrix.data[i]) return false
        }
        return true
    }

    /**
     * A copy of the matrix.
     */
    public clone(): Matrix {
        return new Matrix(this.rows, this.columns, this.data.slice())
    }

    /**
     * The rows of the matrix as arrays of numbers.
     */
    public toArray(): number[][] {
        const rows: number[][] = []
        for (let i: number = 0; i < this.rows; i++) rows.push(Array.from(this.data.subarray(i * this.columns, (i + 1) * this.columns)))
        return rows
    }

    /**
     * The rows of the matrix, as `toArray()`: a matrix in JSON is its rows.
     */
    public toJSON(): number[][] {
        return this.toArray()
    }

    /**
     * The matrix written as in the formulas: its rows separated by semicolons (`[1, 2; 3, 4]`).
     */
    public toString(): string {
        return `[${this.toArray().map((row: number[]): string => row.map(String).join(', ')).join('; ')}]`
    }
}
