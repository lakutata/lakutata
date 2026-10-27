import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {isVector, Matrix, matrixOf, type MatrixValue, type NativeMatrix, vectorOf, type VectorValue} from './Matrix.js'
import {nativeCall} from './Native.js'

/**
 * A sparse matrix as the addon reads and gives it: its rows, its columns, its row pointers, the columns and the values
 * of its entries
 */
export type NativeSparse = [number, number, Int32Array, Int32Array, Float64Array]

/**
 * An entry of a sparse matrix: its row, its column (both from 0), its value
 */
export type SparseEntry = readonly [number, number, number]

//The largest number of rows, of columns and of entries: the addon holds them in 32-bit integers
const LIMIT: number = 2147483647

function dimension(value: number, what: string): number {
    if (!Number.isInteger(value) || value < 0 || value > LIMIT) throw new MathArgumentException(`${what} is an integer from 0 to 2^31 - 1`)
    return value
}

/**
 * A sparse matrix as the addon reads it
 * @param matrix
 */
export function nativeSparseOf(matrix: SparseMatrix): NativeSparse {
    return [matrix.rows, matrix.columns, matrix.rowPointers, matrix.columnIndices, matrix.values]
}

/**
 * A sparse matrix of the addon
 * @param result
 */
export function sparseFrom(result: NativeSparse): SparseMatrix {
    return new SparseMatrix(result[0], result[1], result[2], result[3], result[4])
}

/**
 * An operation on sparse matrices in the thread of JavaScript: its dense results, its sparse ones
 * @param operation
 * @param sparse
 * @param dense
 * @param numbers
 */
export function sparseRun(operation: string, sparse: NativeSparse[], dense: NativeMatrix[] = [], numbers: number[] = []): [NativeMatrix[], NativeSparse[]] {
    return nativeCall((native) => native.run('sparse', [operation, sparse, dense, numbers])) as [NativeMatrix[], NativeSparse[]]
}

/**
 * The sparse matrix of entries, those of the same row and column added up (into one entry, even of 0)
 * @param rows
 * @param columns
 * @param entries
 */
export function sparseOfEntries(rows: number, columns: number, entries: Iterable<SparseEntry>): SparseMatrix {
    dimension(rows, 'The number of rows')
    dimension(columns, 'The number of columns')
    if (entries === null || typeof entries !== 'object' || typeof (entries as Iterable<SparseEntry>)[Symbol.iterator] !== 'function') throw new MathArgumentException('The entries are an iterable of [row, column, value]')
    const list: SparseEntry[] = Array.from(entries)
    if (list.length > LIMIT) throw new MathArgumentException('A sparse matrix has 2^31 - 1 entries at most')
    //The entries counted by row, then placed in their rows, then sorted by column in each
    const pointers: Int32Array = new Int32Array(rows + 1)
    for (const entry of list) {
        if (!Array.isArray(entry) || entry.length !== 3) throw new MathArgumentException('An entry is [row, column, value]')
        const [row, column, value] = entry
        if (!Number.isInteger(row) || row < 0 || row >= rows) throw new MathArgumentException(`The row ${row} of an entry is not one of the ${rows} rows`)
        if (!Number.isInteger(column) || column < 0 || column >= columns) throw new MathArgumentException(`The column ${column} of an entry is not one of the ${columns} columns`)
        if (typeof value !== 'number') throw new MathArgumentException('The value of an entry is not a number')
        pointers[row + 1]++
    }
    for (let i: number = 0; i < rows; i++) pointers[i + 1] += pointers[i]
    const next: Int32Array = pointers.slice(0, rows), placedColumns: Int32Array = new Int32Array(list.length), placedValues: Float64Array = new Float64Array(list.length)
    for (const [row, column, value] of list) {
        const k: number = next[row]++
        placedColumns[k] = column
        placedValues[k] = value
    }
    const rowPointers: Int32Array = new Int32Array(rows + 1), columnIndices: Int32Array = new Int32Array(list.length), values: Float64Array = new Float64Array(list.length)
    let stored: number = 0
    for (let i: number = 0; i < rows; i++) {
        const order: number[] = []
        for (let k: number = pointers[i]; k < pointers[i + 1]; k++) order.push(k)
        order.sort((a: number, b: number): number => placedColumns[a] - placedColumns[b])
        for (const k of order) {
            if (stored > rowPointers[i] && columnIndices[stored - 1] === placedColumns[k]) {
                values[stored - 1] += placedValues[k]
            } else {
                columnIndices[stored] = placedColumns[k]
                values[stored] = placedValues[k]
                stored++
            }
        }
        rowPointers[i + 1] = stored
    }
    return new SparseMatrix(rows, columns, rowPointers, columnIndices.slice(0, stored), values.slice(0, stored))
}

/**
 * The sparse matrix of a dense one: its elements other than 0
 * @param matrix
 */
export function sparseOfMatrix(matrix: Matrix): SparseMatrix {
    dimension(matrix.rows, 'The number of rows')
    dimension(matrix.columns, 'The number of columns')
    let stored: number = 0
    for (const value of matrix.data) if (value !== 0) stored++
    const rowPointers: Int32Array = new Int32Array(matrix.rows + 1), columnIndices: Int32Array = new Int32Array(stored), values: Float64Array = new Float64Array(stored)
    let k: number = 0
    for (let i: number = 0; i < matrix.rows; i++) {
        for (let j: number = 0; j < matrix.columns; j++) {
            const value: number = matrix.data[i * matrix.columns + j]
            if (value === 0) continue
            columnIndices[k] = j
            values[k++] = value
        }
        rowPointers[i + 1] = k
    }
    return new SparseMatrix(matrix.rows, matrix.columns, rowPointers, columnIndices, values)
}

/**
 * A sparse matrix of doubles, in compressed rows (CSR): the columns and the values of its entries row by row, and where
 * each row starts. Only its entries are stored; the other elements are 0. Its operations never change it.
 *
 * Its sums, its transpose and its products by numbers, vectors and dense matrices are computed in JavaScript (in time
 * proportional to its entries); its products by sparse matrices by Eigen. The solutions of its systems are in
 * `math.linalg`: `solve()` (the sparse LU decomposition), `conjugateGradient()` and `biconjugateGradientStabilized()`.
 * @example
 * ```typescript
 * import {Container} from 'lakutata'
 * import {Math, SparseMatrix} from '@lakutata/math'
 *
 * const container: Container = new Container()
 * await container.setNamed('math', Math, {})
 * const math: Math = await container.get<Math>('math')
 * const a: SparseMatrix = math.linalg.sparse(3, 3, [[0, 0, 2], [1, 1, 2], [2, 2, 2], [0, 1, -1], [1, 0, -1]])
 * a.nonZeros                                        //5
 * a.get(0, 1)                                       //-1
 * a.mul([1, 1, 1])                                  //Float64Array [1, 1, 2]
 * a.toDense().toString()                            //[2, -1, 0; -1, 2, 0; 0, 0, 2]
 * math.linalg.solve(a, [1, 1, 2])                   //Float64Array [1, 1, 1]
 * await container.destroy()
 * ```
 */
export class SparseMatrix {

    /**
     * A sparse matrix of its compressed rows, checked, then used as they are (not copied). Its values may be changed
     * afterwards; its structure may not: the addon checks it again at each operation and throws
     * `MathArgumentException` when it is no longer valid.
     * @param rows The rows, an integer from 0 to 2^31 - 1.
     * @param columns The columns, an integer from 0 to 2^31 - 1.
     * @param rowPointers Where each row starts: the entries of row i are those from `rowPointers[i]` to
     * `rowPointers[i + 1] - 1`. `rows + 1` of them, from 0 to the number of entries, never decreasing.
     * @param columnIndices The column of each entry, increasing in each row.
     * @param values The value of each entry.
     */
    constructor(public readonly rows: number, public readonly columns: number, public readonly rowPointers: Int32Array, public readonly columnIndices: Int32Array, public readonly values: Float64Array) {
        dimension(rows, 'The number of rows')
        dimension(columns, 'The number of columns')
        if (!(rowPointers instanceof Int32Array) || !(columnIndices instanceof Int32Array)) throw new MathArgumentException('The row pointers and the columns of a sparse matrix are Int32Arrays')
        if (!(values instanceof Float64Array)) throw new MathArgumentException('The values of a sparse matrix are a Float64Array')
        if (rowPointers.length !== rows + 1) throw new MathArgumentException(`A sparse matrix of ${rows} rows has ${rows + 1} row pointers, not ${rowPointers.length}`)
        if (columnIndices.length !== values.length) throw new MathArgumentException(`A sparse matrix has as many columns of entries as values, not ${columnIndices.length} and ${values.length}`)
        if (rowPointers[0] !== 0 || rowPointers[rows] !== values.length) throw new MathArgumentException('The row pointers of a sparse matrix go from 0 to its number of entries')
        for (let i: number = 0; i < rows; i++) {
            if (rowPointers[i + 1] < rowPointers[i]) throw new MathArgumentException(`The row pointers of a sparse matrix decrease at row ${i}`)
        }
        for (let i: number = 0; i < rows; i++) {
            for (let k: number = rowPointers[i]; k < rowPointers[i + 1]; k++) {
                const column: number = columnIndices[k]
                if (column < 0 || column >= columns) throw new MathArgumentException(`An entry of row ${i} is in column ${column}, not one of the ${columns} columns`)
                if (k > rowPointers[i] && column <= columnIndices[k - 1]) throw new MathArgumentException(`The columns of the entries of row ${i} do not increase`)
            }
        }
    }

    /**
     * The number of entries stored, zeros among them (a sum of entries that is 0, a product by 0).
     */
    public get nonZeros(): number {
        return this.values.length
    }

    #sameSize(other: SparseMatrix, operation: string): void {
        if (!(other instanceof SparseMatrix)) throw new MathArgumentException(`The other matrix of ${operation} is a SparseMatrix`)
        if (other.rows !== this.rows || other.columns !== this.columns) {
            throw new MathArgumentException(`The sparse matrices of ${operation} differ in size: ${this.rows}×${this.columns} and ${other.rows}×${other.columns}`)
        }
    }

    //The entries of either matrix, row by row, of the values of an operation on the elements of both
    #merge(other: SparseMatrix, operation: string, apply: (a: number, b: number) => number): SparseMatrix {
        this.#sameSize(other, operation)
        const rowPointers: Int32Array = new Int32Array(this.rows + 1)
        const columnIndices: Int32Array = new Int32Array(this.values.length + other.values.length), values: Float64Array = new Float64Array(columnIndices.length)
        let stored: number = 0
        for (let i: number = 0; i < this.rows; i++) {
            let k: number = this.rowPointers[i], l: number = other.rowPointers[i]
            const end: number = this.rowPointers[i + 1], otherEnd: number = other.rowPointers[i + 1]
            while (k < end || l < otherEnd) {
                const column: number = k < end ? this.columnIndices[k] : Infinity, otherColumn: number = l < otherEnd ? other.columnIndices[l] : Infinity
                columnIndices[stored] = Math.min(column, otherColumn)
                values[stored++] = apply(column <= otherColumn ? this.values[k++] : 0, otherColumn <= column ? other.values[l++] : 0)
            }
            rowPointers[i + 1] = stored
        }
        return new SparseMatrix(this.rows, this.columns, rowPointers, columnIndices.slice(0, stored), values.slice(0, stored))
    }

    #withValues(values: Float64Array): SparseMatrix {
        return new SparseMatrix(this.rows, this.columns, this.rowPointers.slice(), this.columnIndices.slice(), values)
    }

    /**
     * The element of a row and a column (from 0): the value of its entry, or 0.
     * @param row The row.
     * @param column The column.
     */
    public get(row: number, column: number): number {
        if (!Number.isInteger(row) || row < 0 || row >= this.rows) throw new MathArgumentException(`The row ${row} is not one of the ${this.rows} rows`)
        if (!Number.isInteger(column) || column < 0 || column >= this.columns) throw new MathArgumentException(`The column ${column} is not one of the ${this.columns} columns`)
        let low: number = this.rowPointers[row], high: number = this.rowPointers[row + 1] - 1
        while (low <= high) {
            const middle: number = (low + high) >>> 1
            const found: number = this.columnIndices[middle]
            if (found === column) return this.values[middle]
            if (found < column) low = middle + 1
            else high = middle - 1
        }
        return 0
    }

    /**
     * Its entries, row by row and by column in each row: `[row, column, value]`.
     */
    public toEntries(): [number, number, number][] {
        const entries: [number, number, number][] = []
        for (let i: number = 0; i < this.rows; i++) {
            for (let k: number = this.rowPointers[i]; k < this.rowPointers[i + 1]; k++) entries.push([i, this.columnIndices[k], this.values[k]])
        }
        return entries
    }

    /**
     * The dense matrix of the same elements.
     */
    public toDense(): Matrix {
        const matrix: Matrix = new Matrix(this.rows, this.columns)
        for (let i: number = 0; i < this.rows; i++) {
            for (let k: number = this.rowPointers[i]; k < this.rowPointers[i + 1]; k++) matrix.data[i * this.columns + this.columnIndices[k]] = this.values[k]
        }
        return matrix
    }

    /**
     * The transpose: rows and columns swapped.
     */
    public transpose(): SparseMatrix {
        const rowPointers: Int32Array = new Int32Array(this.columns + 1)
        for (let k: number = 0; k < this.values.length; k++) rowPointers[this.columnIndices[k] + 1]++
        for (let j: number = 0; j < this.columns; j++) rowPointers[j + 1] += rowPointers[j]
        const next: Int32Array = rowPointers.slice(0, this.columns)
        const columnIndices: Int32Array = new Int32Array(this.values.length), values: Float64Array = new Float64Array(this.values.length)
        for (let i: number = 0; i < this.rows; i++) {
            for (let k: number = this.rowPointers[i]; k < this.rowPointers[i + 1]; k++) {
                const at: number = next[this.columnIndices[k]]++
                columnIndices[at] = i
                values[at] = this.values[k]
            }
        }
        return new SparseMatrix(this.columns, this.rows, rowPointers, columnIndices, values)
    }

    /**
     * The sum with a sparse matrix of the same size: its entries are those of either matrix.
     * @param other The other matrix.
     */
    public add(other: SparseMatrix): SparseMatrix {
        return this.#merge(other, 'a sum', (a: number, b: number): number => a + b)
    }

    /**
     * The difference with a sparse matrix of the same size: its entries are those of either matrix.
     * @param other The other matrix.
     */
    public sub(other: SparseMatrix): SparseMatrix {
        return this.#merge(other, 'a difference', (a: number, b: number): number => a - b)
    }

    /**
     * The opposite: each entry negated.
     */
    public neg(): SparseMatrix {
        return this.#withValues(this.values.map((value: number): number => -value))
    }

    /**
     * The product by a number (of the same entries), by a sparse matrix (sparse, by Eigen), by a dense matrix (dense)
     * or by a vector (a vector: a `Float64Array`, or an array of numbers).
     * @param other The other factor, on the right.
     */
    public mul(other: number): SparseMatrix
    public mul(other: SparseMatrix): SparseMatrix
    public mul(other: VectorValue): Float64Array
    public mul(other: MatrixValue): Matrix
    public mul(other: number | SparseMatrix | MatrixValue | VectorValue): SparseMatrix | Matrix | Float64Array
    public mul(other: number | SparseMatrix | MatrixValue | VectorValue): SparseMatrix | Matrix | Float64Array {
        if (typeof other === 'number') return this.#withValues(this.values.map((value: number): number => value * other))
        if (other instanceof SparseMatrix) return sparseFrom(sparseRun('multiply', [nativeSparseOf(this), nativeSparseOf(other)])[1][0])
        if (isVector(other)) {
            const vector: Float64Array = vectorOf(other)
            if (vector.length !== this.columns) throw new MathArgumentException(`A sparse matrix of ${this.columns} columns times a vector of ${vector.length} elements`)
            const product: Float64Array = new Float64Array(this.rows)
            for (let i: number = 0; i < this.rows; i++) {
                let sum: number = 0
                for (let k: number = this.rowPointers[i]; k < this.rowPointers[i + 1]; k++) sum += this.values[k] * vector[this.columnIndices[k]]
                product[i] = sum
            }
            return product
        }
        const matrix: Matrix = matrixOf(other, 'The other factor')
        if (matrix.rows !== this.columns) throw new MathArgumentException(`The matrices cannot be multiplied: ${this.rows}×${this.columns} by ${matrix.rows}×${matrix.columns}`)
        const product: Matrix = new Matrix(this.rows, matrix.columns)
        for (let i: number = 0; i < this.rows; i++) {
            for (let k: number = this.rowPointers[i]; k < this.rowPointers[i + 1]; k++) {
                const value: number = this.values[k], from: number = this.columnIndices[k] * matrix.columns, to: number = i * matrix.columns
                for (let j: number = 0; j < matrix.columns; j++) product.data[to + j] += value * matrix.data[from + j]
            }
        }
        return product
    }
}
