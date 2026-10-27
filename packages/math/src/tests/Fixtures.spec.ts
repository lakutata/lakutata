import {describe, it} from 'node:test'
import assert from 'node:assert'
import {readFileSync} from 'node:fs'
import {type ComplexVector, createMath, type Decimal, type Distribution, type DistributionName, type Eigenvector, Expression, ExpressionMatrix, type IntegralResult, type IterativeSolution, MathException, type MathScope, Matrix, type Normalization, type NormalizationOptions, type ODEResult, type PrimeFactor, type RootResult, type RowEchelonForm, type Solutions, SparseMatrix, type SystemRootResult, type SystemSolution} from '../exports/Math.js'

//The results of SymPy (test-env/fixtures/generate.sh): the values of each result at the sample points, 30 digits
type Complex = [string, string]
type Point = Record<string, string>

interface Expected<T> {
    points: Point[]
    cases: T[]
}

function expected<T>(name: string): Expected<T> {
    return JSON.parse(readFileSync(new URL(`../../../test-env/fixtures/expected/${name}.json`, import.meta.url), 'utf8'))
}

//The value of an expression at a point, or the reason it has none
function valueAt(expression: Expression, point: Point): {re: number, im: number} | string {
    try {
        return expression.substitute(point).toComplex()
    } catch (error) {
        return String((error as Error).message)
    }
}

function close(value: {re: number, im: number} | string, expected: Complex, tolerance: number): boolean {
    if (typeof value === 'string') return false
    const re: number = Number(expected[0]), im: number = Number(expected[1])
    const scale: number = globalThis.Math.max(1, globalThis.Math.hypot(re, im))
    return globalThis.Math.abs(value.re - re) <= tolerance * scale && globalThis.Math.abs(value.im - im) <= tolerance * scale
}

//The values of an expression at the points match SymPy's (the points where SymPy has none are skipped)
function assertValues(expression: Expression, points: Point[], values: (Complex | null)[], label: string, tolerance: number = 1e-9): void {
    points.forEach((point: Point, index: number): void => {
        const value: Complex | null = values[index]
        if (value === null) return
        const ours = valueAt(expression, point)
        assert.ok(close(ours, value, tolerance), `${label} at ${JSON.stringify(point)}: ${JSON.stringify(ours)}, SymPy ${value.join(' + i*')} (${expression.toString()})`)
    })
}

//The checks of the decompositions, which are not unique (signs, the order of eigenvalues): reconstructions, triangles,
//orthonormal columns; each gives the invariant NumPy's reference has
function matrix(rows: number[][]): Matrix {
    return new Matrix(rows.length, rows.length ? rows[0].length : 0, Float64Array.from(rows.flat()))
}

function assertClose(actual: Matrix, expected: Matrix, scale: number, label: string): void {
    assert.ok(actual.equals(expected, 1e-11 * globalThis.Math.max(1, scale)), `${label}: ${actual.toString()} is not ${expected.toString()}`)
}

function largest(a: Matrix): number {
    return a.data.reduce((value: number, element: number): number => globalThis.Math.max(value, globalThis.Math.abs(element)), 0)
}

function assertOrthonormal(math: MathScope, q: Matrix, label: string): void {
    assertClose(q.transpose().mul(q), math.linalg.identity(q.columns), 1, `${label}: columns not orthonormal`)
}

function assertTriangle(a: Matrix, lower: boolean, label: string): void {
    for (let i: number = 0; i < a.rows; i++) {
        for (let j: number = 0; j < a.columns; j++) {
            if ((lower ? j > i : j < i) && a.get(i, j) !== 0) assert.fail(`${label}: not ${lower ? 'lower' : 'upper'} triangular at ${i}, ${j}`)
        }
    }
}

//P A = L U, L unit lower, U upper: the determinant (the sign of the permutation times the diagonal of U)
function luInvariant(math: MathScope, a: Matrix, label: string): number {
    const {lower, upper, permutation} = math.linalg.lu(a)
    assertTriangle(lower, true, label)
    assertTriangle(upper, false, label)
    assert.ok(lower.diagonal().every((value: number): boolean => value === 1), `${label}: L has not ones on its diagonal`)
    assertClose(lower.mul(upper), math.linalg.fromRows(permutation.map((row: number): Float64Array => a.row(row))), largest(a), `${label}: P A is not L U`)
    let sign: number = 1
    const seen: boolean[] = permutation.map((): boolean => false)
    permutation.forEach((_: number, start: number): void => {
        let length: number = 0
        for (let i: number = start; !seen[i]; i = permutation[i]) {
            seen[i] = true
            length++
        }
        if (length && length % 2 === 0) sign = -sign
    })
    return sign * upper.diagonal().reduce((product: number, value: number): number => product * value, 1)
}

//A = Q R, Q of orthonormal columns, R upper: the absolute values of the diagonal of R
function qrInvariant(math: MathScope, a: Matrix, label: string): Float64Array {
    const {q, r} = math.linalg.qr(a)
    assertOrthonormal(math, q, label)
    assertTriangle(r, false, label)
    assertClose(q.mul(r), a, largest(a), `${label}: A is not Q R`)
    return r.diagonal().map(globalThis.Math.abs)
}

//A = U diag(s) Vᵀ, U and V of orthonormal columns: the singular values
function svdInvariant(math: MathScope, a: Matrix, label: string): Float64Array {
    const {u, singularValues, v} = math.linalg.svd(a)
    assertOrthonormal(math, u, label)
    assertOrthonormal(math, v, label)
    assertClose(u.mul(math.linalg.diagonal(singularValues)).mul(v.transpose()), a, largest(a), `${label}: A is not U S Vᵀ`)
    return singularValues
}

//The eigenvalues sorted as NumPy's reference (by their real parts, then their imaginary ones)
function sorted(values: [number, number][]): number[] {
    return values.sort((x: [number, number], y: [number, number]): number => (globalThis.Math.round(x[0] * 1e9) - globalThis.Math.round(y[0] * 1e9)) || x[1] - y[1]).flat()
}

//A v = λ v for each pair: the eigenvalues
function eigenInvariant(math: MathScope, a: Matrix, label: string): number[] {
    const {values, vectors} = math.linalg.eigen(a)
    for (let k: number = 0; k < a.rows; k++) {
        const re: Float64Array = vectors.re.column(k), im: Float64Array = vectors.im.column(k)
        const ar: Float64Array = a.mul(re), ai: Float64Array = a.mul(im)
        for (let i: number = 0; i < a.rows; i++) {
            const lr: number = values.re[k] * re[i] - values.im[k] * im[i], li: number = values.re[k] * im[i] + values.im[k] * re[i]
            assert.ok(globalThis.Math.abs(ar[i] - lr) + globalThis.Math.abs(ai[i] - li) <= 1e-10 * globalThis.Math.max(1, largest(a)), `${label}: A v is not λ v`)
        }
    }
    return sorted(Array.from(values.re, (re: number, k: number): [number, number] => [re, values.im[k]]))
}

//A = V diag(λ) Vᵀ, V orthonormal: the eigenvalues
function symmetricEigenInvariant(math: MathScope, a: Matrix, label: string): Float64Array {
    const {values, vectors} = math.linalg.symmetricEigen(a)
    assertOrthonormal(math, vectors, label)
    assertClose(vectors.mul(math.linalg.diagonal(values)).mul(vectors.transpose()), a, largest(a), `${label}: A is not V Λ Vᵀ`)
    return values
}

//A = U T Uᵀ, U orthogonal, T quasi upper triangular: the eigenvalues of its blocks
function schurInvariant(math: MathScope, a: Matrix, label: string): number[] {
    const {u, t} = math.linalg.schur(a)
    assertOrthonormal(math, u, label)
    assertClose(u.mul(t).mul(u.transpose()), a, largest(a), `${label}: A is not U T Uᵀ`)
    const values: [number, number][] = []
    for (let i: number = 0; i < t.rows; i++) {
        for (let j: number = 0; j < i - 1; j++) assert.strictEqual(t.get(i, j), 0, `${label}: T is not quasi triangular`)
        if (i + 1 < t.rows && t.get(i + 1, i) !== 0) {
            const p: number = t.get(i, i), q: number = t.get(i, i + 1), r: number = t.get(i + 1, i), s: number = t.get(i + 1, i + 1)
            const discriminant: number = ((p - s) / 2) ** 2 + q * r
            const root: number = globalThis.Math.sqrt(globalThis.Math.abs(discriminant))
            values.push(...(discriminant < 0 ? [[(p + s) / 2, -root], [(p + s) / 2, root]] : [[(p + s) / 2 - root, 0], [(p + s) / 2 + root, 0]]) as [number, number][])
            i++
        } else {
            values.push([t.get(i, i), 0])
        }
    }
    return sorted(values)
}

//A decimal as its significant digits and the exponent of the first one: 1.4142e+3 and 1414.2 are the same
function decimalParts(text: string): string {
    const match: RegExpMatchArray | null = /^(-?)(\d*)\.?(\d*)(?:e([-+]?\d+))?$/.exec(text.trim())
    if (!match) return text
    const digits: string = (match[2] + match[3]).replace(/^0+/, '')
    const leadingZeros: number = (match[2] + match[3]).length - (match[2] + match[3]).replace(/^0+/, '').length
    const exponent: number = Number(match[4] ?? 0) + match[2].length - 1 - leadingZeros
    return `${match[1]}${digits.replace(/0+$/, '')}e${exponent}`
}

describe('The fixtures (SymPy, mathjs, nerdamer)', (): void => {
    const math: MathScope = createMath()

    it('read the formulas as SymPy reads their meaning', (): void => {
        const fixtures = expected<{text: string, values?: (Complex | null)[], error?: string}>('grammar')
        for (const fixture of fixtures.cases) {
            if (fixture.error) {
                assert.throws((): unknown => math.expression(fixture.text), (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, fixture.text)
                continue
            }
            assertValues(math.expression(fixture.text), fixtures.points, fixture.values!, fixture.text)
        }
    })

    it('give the numbers and the decimals of SymPy', (): void => {
        const fixtures = expected<{text: string, value: Complex, decimals?: Record<string, string>, doubles?: string}>('numbers')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            assert.ok(close(expression.toComplex(), fixture.value, 1e-13), `${fixture.text}: ${JSON.stringify(expression.toComplex())}, SymPy ${fixture.value.join(' + i*')}`)
            //The compiled function of a real value gives it too, but where the doubles cannot hold it (the case says why)
            if (Number(fixture.value[1]) === 0 && !fixture.doubles) assert.ok(close({re: expression.compile([])(), im: 0}, fixture.value, 1e-13), `${fixture.text} compiled: ${expression.compile([])()}`)
            for (const [digits, text] of Object.entries(fixture.decimals ?? {})) {
                assert.strictEqual(decimalParts(expression.toDecimal(Number(digits))), decimalParts(text), `${fixture.text} to ${digits} digits`)
            }
        }
    })

    it('give the decimals of the special functions of SymPy (mpmath)', (): void => {
        const fixtures = expected<{text: string, decimals: Record<string, string>}>('special')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            for (const [digits, text] of Object.entries(fixture.decimals)) {
                assert.strictEqual(decimalParts(expression.toDecimal(Number(digits))), decimalParts(text), `${fixture.text} to ${digits} digits`)
            }
        }
    })

    it('give the complex decimals of SymPy, each part to its digits, on and off the branch cuts', (): void => {
        const fixtures = expected<{text: string, decimals: Record<string, [string, string]>}>('complex')
        for (const fixture of fixtures.cases) {
            const expression: Expression = math.expression(fixture.text)
            for (const [digits, [re, im]] of Object.entries(fixture.decimals)) {
                const value: {re: string, im: string} = expression.toComplexDecimal(Number(digits))
                assert.strictEqual(decimalParts(value.re), decimalParts(re), `re(${fixture.text}) to ${digits} digits`)
                assert.strictEqual(decimalParts(value.im), decimalParts(im), `im(${fixture.text}) to ${digits} digits`)
            }
        }
    })

    it('give the decimals of Python (arithmetic) and mpmath (functions), correctly rounded', (): void => {
        const fixtures = expected<{op: string, precision: number, args: string[], result: string}>('decimals')
        for (const fixture of fixtures.cases) {
            const [first, second] = fixture.args
            const decimal: Decimal = math.decimal(first, {precision: fixture.precision})
            const operations: Record<string, () => Decimal | string> = {
                round: (): Decimal => decimal,
                root: (): Decimal => decimal.root(Number(second)),
                roundTo: (): Decimal => decimal.round(Number(second)),
                fixed: (): string => decimal.toFixed(Number(second))
            }
            const operate: () => Decimal | string = operations[fixture.op] ?? ((): Decimal => (decimal[fixture.op as keyof Decimal] as (value?: string) => Decimal).call(decimal, second))
            assert.strictEqual(String(operate()), fixture.result, `${fixture.op}(${fixture.args.join(', ')}) to ${fixture.precision} digits`)
        }
    })

    it('give the linear algebra of NumPy and SciPy', (): void => {
        type Nested = number | Nested[]
        //A sparse matrix of a case: its entries
        type Sparse = {rows: number, columns: number, entries: [number, number, number][]}
        const fixtures = expected<{op: string, args: (number[][] | number[] | Sparse)[], triangle?: 'lower' | 'upper', tolerance?: number, kind?: number | 'fro' | 'inf', result?: Nested, error?: string}>('linalg')
        const sparse = (value: unknown): SparseMatrix => math.linalg.sparse((value as Sparse).rows, (value as Sparse).columns, (value as Sparse).entries)
        //The elements of a result, flat
        const flat = (value: unknown): number[] => {
            if (typeof value === 'number') return [value]
            if (value instanceof Matrix) return Array.from(value.data)
            if (value instanceof Float64Array) return Array.from(value)
            return (value as Nested[]).flatMap((element: Nested): number[] => flat(element))
        }
        for (const fixture of fixtures.cases) {
            const [a, b] = fixture.args as [number[][], number[][] & number[]]
            const label: string = `${fixture.op}(${JSON.stringify(fixture.args).slice(0, 80)})`
            const operate = (): unknown => {
                switch (fixture.op) {
                    case 'multiply': return math.linalg.multiply(a, b)
                    case 'solve': return math.linalg.solve(a, b)
                    case 'solveTriangular': return math.linalg.solveTriangular(a, b, fixture.triangle!)
                    case 'leastSquares': return math.linalg.leastSquares(a, b)
                    case 'inverse': return math.linalg.inverse(a)
                    case 'determinant': return math.linalg.determinant(a)
                    case 'rank': return math.linalg.rank(a, fixture.tolerance ?? undefined)
                    case 'singularValues': return math.linalg.singularValues(a)
                    case 'condition': return math.linalg.condition(a)
                    case 'norm': return math.linalg.norm(fixture.args[0] as number[][] | number[], fixture.kind === 'inf' ? Infinity : fixture.kind)
                    case 'lu': return luInvariant(math, matrix(a), label)
                    case 'qr': return qrInvariant(math, matrix(a), label)
                    case 'cholesky': return math.linalg.cholesky(a)
                    case 'svd': return svdInvariant(math, matrix(a), label)
                    case 'eigen': return eigenInvariant(math, matrix(a), label)
                    case 'symmetricEigen': return symmetricEigenInvariant(math, matrix(a), label)
                    case 'schur': return schurInvariant(math, matrix(a), label)
                    case 'pseudoInverse': return math.linalg.pseudoInverse(a)
                    case 'exponential': return math.linalg.exponential(a)
                    case 'squareRoot': return math.linalg.squareRoot(a)
                    case 'sylvester': return math.linalg.sylvester(a, b, fixture.args[2] as number[][])
                    case 'lyapunov': return math.linalg.lyapunov(a, b)
                    case 'sparseMultiply': return sparse(a).mul(sparse(b)).toDense()
                    case 'sparseSolve': return math.linalg.solve(sparse(a), b)
                    case 'conjugateGradient': return math.linalg.conjugateGradient(sparse(a), b)
                    case 'biconjugateGradientStabilized': return math.linalg.biconjugateGradientStabilized(sparse(a), b)
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) {
                assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            const outcome: unknown = operate()
            if (fixture.op === 'conjugateGradient' || fixture.op === 'biconjugateGradientStabilized') {
                //Not its iterates: it converged, its residual is of the tolerance (1e-10 of ‖b‖ by default), and its
                //solution near SuperLU's (κ times the tolerance)
                const {solution, converged} = outcome as IterativeSolution
                const residual: Float64Array = sparse(a).mul(solution).map((value: number, i: number): number => value - b[i])
                assert.ok(converged, `${label}: not converged`)
                assert.ok(math.linalg.norm(residual) <= 1e-9 * math.linalg.norm(b), `${label}: residual ${math.linalg.norm(residual)}`)
                const direct: number[] = flat(fixture.result)
                assert.ok(solution.every((value: number, i: number): boolean => globalThis.Math.abs(value - direct[i]) <= 1e-6 * globalThis.Math.max(1, ...direct.map(globalThis.Math.abs))), `${label}: far from SuperLU's solution`)
                continue
            }
            const ours: number[] = flat(outcome), theirs: number[] = flat(fixture.result)
            const scale: number = globalThis.Math.max(1, ...theirs.map(globalThis.Math.abs))
            assert.strictEqual(ours.length, theirs.length, label)
            ours.forEach((value: number, i: number): void => {
                assert.ok(globalThis.Math.abs(value - theirs[i]) <= 1e-11 * scale, `${label}: ${value}, NumPy ${theirs[i]}`)
            })
        }
    })

    it('give the statistics of Python (exactly where it can), NumPy and SciPy', (): void => {
        const fixtures = expected<{op: string, args: number[][], normalization?: Normalization, result?: number | string | (number | string)[], error?: string}>('stats')
        //The statistics of the order of the values, computed by the same formulas: equal
        const exact: Set<string> = new Set(['median', 'quantile', 'mode', 'min', 'max', 'differences', 'medianAbsoluteDeviation'])
        for (const fixture of fixtures.cases) {
            const [x, y] = fixture.args
            const options: NormalizationOptions | undefined = fixture.normalization ? {normalization: fixture.normalization} : undefined
            const label: string = `${fixture.op}(${JSON.stringify(fixture.args).slice(0, 80)})`
            const operate = (): number | Float64Array => {
                switch (fixture.op) {
                    case 'sum': return math.stats.sum(x)
                    case 'product': return math.stats.product(x)
                    case 'cumulativeSum': return math.stats.cumulativeSum(x)
                    case 'differences': return math.stats.differences(x)
                    case 'mean': return math.stats.mean(x)
                    case 'median': return math.stats.median(x)
                    case 'mode': return math.stats.mode(x)
                    case 'min': return math.stats.min(x)
                    case 'max': return math.stats.max(x)
                    case 'variance': return math.stats.variance(x, options)
                    case 'standardDeviation': return math.stats.standardDeviation(x, options)
                    case 'medianAbsoluteDeviation': return math.stats.medianAbsoluteDeviation(x)
                    case 'quantile': return math.stats.quantile(x, y)
                    case 'covariance': return math.stats.covariance(x, y, options)
                    case 'correlation': return math.stats.correlation(x, y)
                    case 'zScores': return math.stats.zScores(x, options)
                    case 'klDivergence': return math.stats.klDivergence(x, y)
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) {
                assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            const value: number | Float64Array = operate()
            //The numbers that are not finite are strings in the expected files
            const ours: number[] = typeof value === 'number' ? [value] : Array.from(value), theirs: number[] = [fixture.result].flat().map(Number)
            const scale: number = globalThis.Math.max(1, ...theirs.filter(Number.isFinite).map(globalThis.Math.abs))
            assert.strictEqual(ours.length, theirs.length, label)
            ours.forEach((element: number, i: number): void => {
                const same: boolean = exact.has(fixture.op) ? Object.is(element, theirs[i]) : Object.is(element, theirs[i]) || globalThis.Math.abs(element - theirs[i]) <= 1e-14 * scale
                assert.ok(same, `${label}: ${element}, expected ${theirs[i]}`)
            })
        }
    })

    it('give the values of the distributions of SciPy', (): void => {
        type Value = number | string
        const fixtures = expected<{distribution: DistributionName, parameters: Record<string, number>, x: number[], p: number[], expected?: Record<string, Value | Value[]>, differs?: Record<string, string>, error?: string}>('distributions')
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.distribution}(${JSON.stringify(fixture.parameters)})`
            if (fixture.error) {
                assert.throws((): unknown => math.stats.distribution(fixture.distribution, fixture.parameters), (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            const distribution: Distribution = math.stats.distribution(fixture.distribution, fixture.parameters)
            const ours: Record<string, number | readonly number[] | Float64Array> = {
                pdf: distribution.pdf(fixture.x),
                cdf: distribution.cdf(fixture.x),
                survival: distribution.survival(fixture.x),
                quantile: distribution.quantile(fixture.p),
                survivalQuantile: distribution.survivalQuantile(fixture.p),
                mean: distribution.mean,
                variance: distribution.variance,
                skewness: distribution.skewness,
                excessKurtosis: distribution.excessKurtosis,
                median: distribution.median,
                support: distribution.support
            }
            for (const [key, value] of Object.entries(fixture.expected!)) {
                if (fixture.differs?.[key]) continue
                //The numbers that are not finite are strings in the expected files
                const theirs: number[] = [value].flat().map(Number), mine: number[] = typeof ours[key] === 'number' ? [ours[key] as number] : Array.from(ours[key] as ArrayLike<number>)
                mine.forEach((element: number, i: number): void => {
                    let expectedValue: number = theirs[i]
                    //SciPy's survival quantile of 1 of a discrete distribution is one below its support (as its
                    //quantile of 0): the lower bound of the support here
                    if (key === 'survivalQuantile' && distribution.kind === 'discrete' && fixture.p[i] === 1) expectedValue = distribution.support[0]
                    const exact: boolean = distribution.kind === 'discrete' && (key === 'quantile' || key === 'survivalQuantile' || key === 'median' || key === 'support')
                    const same: boolean = Object.is(element, expectedValue) || (!exact && globalThis.Math.abs(element - expectedValue) <= 1e-13 * globalThis.Math.abs(expectedValue))
                    assert.ok(same, `${label} ${key}[${i}]: ${element}, SciPy ${expectedValue}`)
                })
            }
        }
    })

    it('give the numeric roots of NumPy, mpmath and SciPy, the integrals of mpmath and the solutions of SciPy\'s solve_ivp', (): void => {
        type Fixture = {op: string, polynomial?: string, coefficients?: number[], multiple?: boolean, function?: string, bracket?: [number, number], guess?: number | number[], equations?: string[], variables?: string[], interval?: [number | string, number | string], points?: number[], notConverged?: boolean, derivatives?: string[], states?: string[], time?: string, span?: [number, number], initial?: number[], method?: 'rk45' | 'radau', defaultTolerance?: number, result?: unknown, error?: string}
        //JSON has no infinity: the infinite ends are 'inf' and '-inf'
        const end = (value: number | string): number => value === 'inf' ? Infinity : value === '-inf' ? -Infinity : value as number
        const fixtures = expected<Fixture>('numeric')
        const near = (ours: number, theirs: number, tolerance: number): boolean => globalThis.Math.abs(ours - theirs) <= tolerance * (1 + globalThis.Math.abs(theirs))
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.op}(${JSON.stringify(fixture.polynomial ?? fixture.coefficients ?? fixture.function ?? fixture.equations)})`
            const operate = (): unknown => {
                switch (fixture.op) {
                    case 'polynomialRoots': return math.numeric.polynomialRoots(fixture.polynomial ?? fixture.coefficients!)
                    case 'findRoot': return math.numeric.findRoot(fixture.function!, 'x', fixture.bracket ? {bracket: fixture.bracket} : {guess: fixture.guess as number})
                    case 'solveSystem': return math.numeric.solveSystem(fixture.equations!, fixture.variables!, fixture.guess as number[])
                    case 'integrate': return math.numeric.integrate(fixture.function!, 'x', [end(fixture.interval![0]), end(fixture.interval![1])], {points: fixture.points})
                    case 'solveODE': return math.numeric.solveODE({derivatives: fixture.derivatives!, states: fixture.states!, time: fixture.time, span: fixture.span!, initial: fixture.initial!}, {method: fixture.method, points: fixture.points, relativeTolerance: 1e-10, absoluteTolerance: 1e-12})
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) {
                assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            if (fixture.op === 'polynomialRoots') {
                //Sorted by their real parts then their imaginary ones; a multiple root to about the cube root of epsilon
                const ours = operate() as ComplexVector, theirs = fixture.result as {re: number[], im: number[]}
                const tolerance: number = fixture.multiple ? 1e-4 : 1e-10
                assert.strictEqual(ours.re.length, theirs.re.length, label)
                ours.re.forEach((re: number, i: number): void => assert.ok(near(re, theirs.re[i], tolerance) && near(ours.im[i], theirs.im[i], tolerance), `${label}: ${re} + ${ours.im[i]}i, NumPy ${theirs.re[i]} + ${theirs.im[i]}i`))
            } else if (fixture.op === 'solveODE') {
                //SciPy's solve_ivp at 1e-12; ours at 1e-10, and at the default tolerances within the case's own bound
                const theirs = (fixture.result as {y: number[][]}).y
                const compare = (ours: ODEResult, tolerance: number, kind: string): void => {
                    assert.ok(ours.completed && ours.y.rows === theirs.length, `${label} ${kind}: ${ours.message}`)
                    theirs.forEach((row: number[], i: number): void => row.forEach((value: number, j: number): void => assert.ok(near(ours.y.get(i, j), value, tolerance), `${label} ${kind}: at ${fixture.points![i]}, ${ours.y.get(i, j)}, SciPy ${value}`)))
                }
                compare(operate() as ODEResult, 1e-6, 'at 1e-10')
                if (fixture.defaultTolerance) compare(math.numeric.solveODE({derivatives: fixture.derivatives!, states: fixture.states!, time: fixture.time, span: fixture.span!, initial: fixture.initial!}, {method: fixture.method, points: fixture.points}), fixture.defaultTolerance, 'by default')
            } else if (fixture.op === 'integrate') {
                //mpmath's quad at 30 digits; where doubles cannot converge (x^-0.99 has 0.08 of its integral below
                //10^-308), only that it does not
                const ours = operate() as IntegralResult, theirs = (fixture.result as {value: number}).value
                if (fixture.notConverged) assert.ok(!ours.converged, `${label}: ${JSON.stringify(ours)} converged`)
                else assert.ok(ours.converged && near(ours.value, theirs, 1e-12), `${label}: ${JSON.stringify(ours)}, mpmath ${theirs}`)
            } else if (fixture.op === 'findRoot') {
                const ours = operate() as RootResult
                assert.ok(ours.converged && near(ours.root, fixture.result as number, 1e-12), `${label}: ${JSON.stringify(ours)}, mpmath ${fixture.result}`)
            } else {
                const ours = operate() as SystemRootResult
                assert.ok(ours.converged, `${label}: not converged`)
                ours.solution.forEach((value: number, i: number): void => assert.ok(near(value, (fixture.result as number[])[i], 1e-9), `${label}: ${Array.from(ours.solution)}, mpmath ${fixture.result}`))
            }
        }
    })

    it('expand as SymPy, to the same canonical form', (): void => {
        const fixtures = expected<{text: string, result: string, values: (Complex | null)[]}>('expand')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).expand()
            assert.strictEqual(ours.toString(), math.expression(fixture.result).expand().toString(), fixture.text)
            assertValues(ours, fixtures.points, fixture.values, fixture.text)
        }
    })

    it('derive as SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, times?: number, result: string, values: (Complex | null)[]}>('diff')
        for (const fixture of fixtures.cases) {
            assertValues(math.expression(fixture.text).diff(fixture.variable, fixture.times ?? 1), fixtures.points, fixture.values, `d/d${fixture.variable} ${fixture.text}`)
        }
    })

    it('give the series of SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, point: string, order: number, result: string, values: (Complex | null)[]}>('series')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).series(fixture.variable, fixture.point, fixture.order)
            assert.strictEqual(ours.expand().toString(), math.expression(fixture.result).expand().toString(), `${fixture.text} at ${fixture.point}`)
        }
    })

    it('substitute as SymPy', (): void => {
        const fixtures = expected<{text: string, with: Record<string, string>, result: string}>('substitute')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text).substitute(fixture.with)
            assert.ok(ours.equals(fixture.result), `${fixture.text} with ${JSON.stringify(fixture.with)}: ${ours.toString()}, SymPy ${fixture.result}`)
        }
    })

    it('solve the equations as SymPy', (): void => {
        const fixtures = expected<{text: string, variable: string, domain?: 'real', kind: string, solutions?: {text: string, values: (Complex | null)[]}[]}>('solve')
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.text} = 0${fixture.domain ? ' in the reals' : ''}`
            const solutions: Solutions = math.expression(fixture.text).solve(fixture.variable, {domain: fixture.domain})
            assert.strictEqual(solutions.kind, fixture.kind, label)
            if (fixture.kind !== 'finite') continue
            assert.strictEqual(solutions.length, fixture.solutions!.length, `${label}: ${solutions.map(String).join(', ')}`)
            fixtures.points.forEach((point: Point, index: number): void => {
                const ours = solutions.map((solution: Expression) => valueAt(solution, point))
                for (const solution of fixture.solutions!) {
                    const value: Complex | null = solution.values[index]
                    if (value === null) continue
                    const found: number = ours.findIndex((candidate) => close(candidate, value, 1e-9))
                    assert.ok(found >= 0, `${label}: SymPy's ${solution.text} is not among ${solutions.map(String).join(', ')}`)
                    ours.splice(found, 1)
                }
            })
        }
    })

    it('give the coefficients, the degrees and the divisions of polynomials as SymPy', (): void => {
        type Value = {text: string, values: (Complex | null)[]}
        const fixtures = expected<{text: string, variable: string, divisor?: string, degree: number, coefficients: Value[], quotient?: Value, remainder?: Value}>('polynomials')
        for (const fixture of fixtures.cases) {
            const ours: Expression = math.expression(fixture.text)
            assert.strictEqual(ours.degree(fixture.variable), fixture.degree, `${fixture.text}: degree`)
            const coefficients: Expression[] = ours.coefficients(fixture.variable)
            assert.strictEqual(coefficients.length, fixture.coefficients.length, `${fixture.text}: ${coefficients.map(String).join(', ')}`)
            coefficients.forEach((coefficient: Expression, index: number): void => assertValues(coefficient, fixtures.points, fixture.coefficients[index].values, `${fixture.text}: coefficient ${index}`))
            if (!fixture.divisor) continue
            const {quotient, remainder} = ours.divide(fixture.divisor, fixture.variable)
            assertValues(quotient, fixtures.points, fixture.quotient!.values, `${fixture.text} / ${fixture.divisor}: quotient`)
            assertValues(remainder, fixtures.points, fixture.remainder!.values, `${fixture.text} / ${fixture.divisor}: remainder`)
        }
    })

    it('give the matrices of expressions of SymPy', (): void => {
        type ExpressionResult = {text: string | null, values: (Complex | null)[]}
        type MatrixResult = {rows: number, columns: number, elements: ExpressionResult[]}
        type Fixture = {op: string, rows?: string[][], b?: string[][], other?: string[][], exponent?: number, text?: string, error?: string, result?: unknown}
        const fixtures = expected<Fixture>('matrices')
        const compareMatrix = (ours: ExpressionMatrix, theirs: MatrixResult, label: string): void => {
            assert.ok(ours.rows === theirs.rows && ours.columns === theirs.columns, `${label}: ${ours.rows}×${ours.columns}`)
            const elements: Expression[] = ours.toArray().flat()
            theirs.elements.forEach((element: ExpressionResult, i: number): void => assertValues(elements[i], fixtures.points, element.values, `${label} [${i}]`))
        }
        //A·v, or (A - value I)·v, 0 at the points
        const assertNull = (a: ExpressionMatrix, v: ExpressionMatrix, label: string): void => a.mul(v).toArray().flat().forEach((element: Expression): void => assertValues(element, fixtures.points, fixtures.points.map((): Complex => ['0', '0']), label))
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.op}(${fixture.text ?? JSON.stringify(fixture.rows)})`
            if (fixture.op === 'parse') {
                const ours = math.parse(fixture.text!)
                if (ours instanceof ExpressionMatrix) compareMatrix(ours, fixture.result as MatrixResult, label)
                else assertValues(ours as Expression, fixtures.points, (fixture.result as ExpressionResult).values, label)
                continue
            }
            const a: ExpressionMatrix = math.expressionMatrix(fixture.rows!)
            const operate = (): unknown => {
                switch (fixture.op) {
                    case 'determinant': return a.determinant()
                    case 'inverse': return a.inverse()
                    case 'solve': return a.solve(fixture.b!)
                    case 'rref': return a.rref()
                    case 'rank': return a.rank()
                    case 'nullspace': return a.nullspace()
                    case 'characteristicPolynomial': return a.characteristicPolynomial()
                    case 'eigenvectors': return a.eigenvectors()
                    case 'pow': return a.pow(fixture.exponent!)
                    case 'mul': return a.mul(fixture.other!)
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) {
                assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            const ours = operate()
            if (fixture.op === 'determinant' || fixture.op === 'characteristicPolynomial') {
                assertValues(ours as Expression, fixtures.points, (fixture.result as ExpressionResult).values, label)
            } else if (fixture.op === 'rref') {
                const form = ours as RowEchelonForm, theirs = fixture.result as {matrix: MatrixResult, pivots: number[]}
                compareMatrix(form.matrix, theirs.matrix, label)
                assert.deepStrictEqual(form.pivots, theirs.pivots, label)
            } else if (fixture.op === 'rank') {
                assert.strictEqual(ours, fixture.result, label)
            } else if (fixture.op === 'nullspace') {
                const basis = ours as ExpressionMatrix[]
                assert.strictEqual(basis.length, fixture.result, label)
                basis.forEach((v: ExpressionMatrix): void => assertNull(a, v, label))
            } else if (fixture.op === 'eigenvectors') {
                //The same eigenvalues (by their values), multiplicities and numbers of eigenvectors, in any order
                const theirs = fixture.result as {value: ExpressionResult, multiplicity: number, count: number}[], found = ours as Eigenvector[]
                assert.strictEqual(found.length, theirs.length, label)
                for (const expected of theirs) {
                    const match: Eigenvector | undefined = found.find((candidate: Eigenvector): boolean => fixtures.points.every((point: Point, i: number): boolean => expected.value.values[i] === null || close(valueAt(candidate.value, point), expected.value.values[i]!, 1e-9)))
                    assert.ok(match && match.multiplicity === expected.multiplicity && match.vectors.length === expected.count, `${label}: ${expected.value.text}`)
                    const identity: ExpressionMatrix = math.expressionMatrix(Array.from({length: a.rows}, (_: unknown, i: number): number[] => Array.from({length: a.rows}, (__: unknown, j: number): number => i === j ? 1 : 0)))
                    match.vectors.forEach((v: ExpressionMatrix): void => assertNull(a.sub(identity.mul(match.value)), v, `${label}: ${expected.value.text}`))
                }
            } else {
                compareMatrix(ours as ExpressionMatrix, fixture.result as MatrixResult, label)
            }
        }
    })

    it('give the continued fractions of SymPy', (): void => {
        const fixtures = expected<{op: string, value?: string, terms?: string[] | number, error?: string, result?: string | string[]}>('continued')
        for (const fixture of fixtures.cases) {
            const label: string = `${fixture.op}(${JSON.stringify(fixture.value ?? fixture.terms)})`
            const operate = (): unknown => {
                switch (fixture.op) {
                    case 'continuedFraction': return math.ntheory.continuedFraction(fixture.value!, typeof fixture.terms === 'number' ? {terms: fixture.terms} : undefined).map(String)
                    case 'fromContinuedFraction': return math.ntheory.fromContinuedFraction((fixture.terms as string[]).map(BigInt)).toString()
                    case 'convergents': return math.ntheory.convergents((fixture.terms as string[]).map(BigInt)).map(String)
                }
                throw new Error(`Unknown operation ${fixture.op}`)
            }
            if (fixture.error) assert.throws(operate, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
            else assert.deepStrictEqual(operate(), fixture.result, label)
        }
    })

    it('give the number theory of SymPy', (): void => {
        const fixtures = expected<{op: string, args: (string | string[])[], error?: string, result?: unknown}>('ntheory')
        const ntheory = math.ntheory as unknown as Record<string, (...args: unknown[]) => unknown>
        //A result as the fixtures write it: integers as decimal strings, null for no value
        const written = (op: string, value: unknown): unknown => {
            if (value === undefined) return null
            if (typeof value === 'bigint') return String(value)
            if (value instanceof Expression) return value.toString()
            if (op === 'factor') return (value as PrimeFactor[]).map((factor: PrimeFactor): unknown[] => [String(factor.prime), factor.exponent])
            if (op === 'extendedGcd') return [(value as {gcd: bigint}).gcd, (value as {x: bigint}).x, (value as {y: bigint}).y].map(String)
            if (op === 'crt') return [(value as {remainder: bigint}).remainder, (value as {modulus: bigint}).modulus].map(String)
            return value
        }
        for (const fixture of fixtures.cases) {
            const args: unknown[] = fixture.args.map((arg: string | string[]): unknown => Array.isArray(arg) ? arg.map(BigInt) : BigInt(arg))
            const label: string = `${fixture.op}(${fixture.args.map((arg: string | string[]): string => JSON.stringify(arg)).join(', ')})`
            const call = (): unknown => fixture.op === 'gcd' || fixture.op === 'lcm' ? ntheory[fixture.op](...(args[0] as bigint[])) : ntheory[fixture.op](...args)
            if (fixture.error) {
                assert.throws(call, (error: unknown): boolean => error instanceof MathException && (error as MathException).errno === fixture.error, label)
                continue
            }
            assert.deepStrictEqual(written(fixture.op, call()), fixture.result, label)
        }
    })

    it('solve the linear systems as SymPy', (): void => {
        const fixtures = expected<{equations: string[], variables: string[], kind: string, values?: Record<string, {text: string, values: (Complex | null)[]}>}>('systems')
        for (const fixture of fixtures.cases) {
            const label: string = fixture.equations.join(', ')
            const solutions: SystemSolution[] = math.solve(fixture.equations, fixture.variables)
            if (fixture.kind === 'empty') {
                assert.deepStrictEqual(solutions, [], label)
                continue
            }
            assert.strictEqual(solutions.length, 1, label)
            assert.deepStrictEqual(Object.keys(solutions[0]).sort(), Object.keys(fixture.values!).sort(), label)
            for (const [name, value] of Object.entries(fixture.values!)) assertValues(solutions[0][name], fixtures.points, value.values, `${label}: ${name}`)
        }
    })
})
