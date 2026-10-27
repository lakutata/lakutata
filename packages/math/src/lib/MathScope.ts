import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathSyntaxException} from '../exceptions/MathSyntaxException.js'
import {AsyncTracker, type AsyncOptions, Context, definitionsOf} from './Context.js'
import {Decimal, type DecimalOptions, decimalText, type DecimalValue} from './Decimal.js'
import {Matrix, matrixOf, type MatrixValue} from './Matrix.js'
import {Equation, equationHandleOf, Expression, expressionOf, formulaOf, handleOf, Inequality, type Value} from './Expression.js'
import {LinearAlgebra} from './LinearAlgebra.js'
import {type Handle, native, nativeCall} from './Native.js'
import {NumberTheory} from './NumberTheory.js'
import {Numeric} from './Numeric.js'
import {Statistics} from './Statistics.js'

/**
 * One solution of a system of equations: the values of the variables it determines, by their names. When the system
 * does not determine every variable, the values are given in terms of the other ones (`{x: '-y + 3'}`).
 */
export type SystemSolution = Record<string, Expression>

/**
 * An equation of a system: an equation, a formula (`'x + y = 3'`), or an expression equal to zero
 */
export type SystemEquation = Equation | Expression | string

/**
 * The definitions of formulas: a body by signature (`{'f(x)': 'x^2 + 1', 'g': 9.80665}`)
 */
export type MathDefinitions = Record<string, string | number>

/**
 * The common subexpressions of expressions: the replacements, in order, and the expressions written with them
 */
export interface CommonSubexpressions {
    /**
     * The subexpressions met more than once, each with its name; a value may use the names before it.
     */
    replacements: {name: string, value: Expression}[]
    /**
     * The expressions, written with the names of the replacements.
     */
    expressions: Expression[]
}

/**
 * The options of `cse()`
 */
export interface CseOptions {
    /**
     * The prefix of the names of the replacements: `x` by default (`x0`, `x1`…). Names already used by variables of
     * the expressions are skipped.
     */
    prefix?: string
}

/**
 * The options of `createMath()`: all of them have a default value
 */
export interface MathOptions {
    /**
     * The functions and the constants its formulas use: a body by signature (`{'f(x)': 'x^2 + 1', 'g': 9.80665}`).
     * They do not change once it is created; `with()` adds others for a while. None by default.
     */
    definitions?: MathDefinitions
    /**
     * The significant digits of `toDecimal()` and of `decimal()` when none are given: an integer from 1 to 100000.
     * @default 32
     */
    precision?: number
    /**
     * The time limit of the asynchronous operations when none is given, in milliseconds: 0 for none.
     * @default 0
     */
    timeout?: number
    /**
     * How many of its asynchronous operations run at the same time in the threads of the addon (the others wait their
     * turn): all of its threads by default (the processor's cores minus one, or the environment variable
     * `LAKUTATA_MATH_THREADS`).
     */
    concurrency?: number
}

/**
 * A scope of definitions and settings: its formulas are parsed with its definitions (`parse()`, `expression()`,
 * `equation()`), and its decimals, matrices, systems of equations, number theory, linear algebra, statistics and
 * numeric solutions use its settings. `createMath()` makes one; `with()` gives another one over it, for definitions
 * used for a while (they do not change it). The functions exported by the package (`expression()`, `linalg`…) belong to
 * `math`, the scope made with the default options.
 * @example
 * ```typescript
 * import {createMath, type MathScope} from '@lakutata/math'
 *
 * const math: MathScope = createMath({definitions: {'tax(x)': 'x * 0.13'}, precision: 50})
 * console.log(math.expression('tax(200)').toNumber())                     //26
 * const scope: MathScope = math.with({'area(r)': 'pi*r^2'})
 * console.log(scope.expression('area(2)').toString())                     //4pi
 * console.log(scope.expression('area(r)').diff('r').toString())           //2pi*r
 * ```
 */
export class MathScope {

    #ntheory?: NumberTheory

    #linalg?: LinearAlgebra

    #stats?: Statistics

    #numeric?: Numeric

    /**
     * A scope over a context. Made by `createMath()` and by `with()`.
     * @param context The context: its definitions, its settings.
     */
    constructor(protected readonly context: Context) {
    }

    /**
     * The number theory of the integers (bigints): primes, factorization, modular arithmetic, integer sequences,
     * combinatorial numbers and counting. Its asynchronous operations share the threads, the time limit and the
     * concurrency of the scope.
     */
    public get ntheory(): NumberTheory {
        return this.#ntheory ??= new NumberTheory(this.context)
    }

    /**
     * The numeric linear algebra (on Eigen): matrices of zeros, identities, rotations; products, norms; the solutions
     * of linear systems, least squares, inverses, determinants, ranks, decompositions, functions of matrices, sparse
     * matrices.
     */
    public get linalg(): LinearAlgebra {
        return this.#linalg ??= new LinearAlgebra(this.context)
    }

    /**
     * The statistics of values (arrays of numbers, or `Float64Array`s): sums, means, medians, modes, variances,
     * quantiles, covariances, correlations; the probability distributions (`normal()` … `hypergeometric()`) and a
     * generator of random numbers (`random()`).
     */
    public get stats(): Statistics {
        return this.#stats ??= new Statistics(this.context)
    }

    /**
     * The numeric solutions of equations, the integrals and the differential equations: the roots of polynomials, a
     * root of a function, a solution of a system of nonlinear equations, the integral of a function, the solution of
     * ordinary differential equations.
     */
    public get numeric(): Numeric {
        return this.#numeric ??= new Numeric(this.context)
    }

    /**
     * Parse a formula: an expression (`x^2 - 5x + 6`), an equation (`x^2 = 4`) or an inequality (`x^2 < 4`).
     * @param text The formula.
     */
    public parse(text: string): Expression | Equation | Inequality {
        if (typeof text !== 'string') throw new MathArgumentException('The formula is not a string')
        return formulaOf(this.context, text)
    }

    /**
     * An expression: a formula parsed (an equation is an error), or the exact value of a number (`0.1` is `1/10`).
     * @param value The formula, or the number.
     */
    public expression(value: Value): Expression {
        if (value instanceof Expression) return value
        if (typeof value === 'string') return expressionOf(this.context, value)
        return new Expression(this.context, handleOf(this.context, value))
    }

    /**
     * A decimal of a precision: a value rounded to that many significant digits (halves to even). A number is read by
     * its shortest representation (`0.1` is 0.1), a string as a decimal number (`'19.99'`); an expression is computed,
     * as `toDecimal()` does.
     * @param value A decimal number (a number, a bigint, a string, a decimal) or an expression without variables.
     * @param options The precision: the one of the scope by default.
     */
    public decimal(value: DecimalValue | Expression, options: DecimalOptions = {}): Decimal {
        const precision: number = options.precision ?? this.context.settings.precision
        if (!Number.isInteger(precision) || precision < 1 || precision > 100000) throw new MathArgumentException('The precision is an integer from 1 to 100000')
        if (value instanceof Expression) return new Decimal(value.toDecimal(precision), precision)
        return new Decimal(nativeCall((native) => native.run('decimalOperation', ['round', precision, decimalText(value)])) as string, precision)
    }

    /**
     * A matrix of numbers: of its rows (`[[1, 2], [3, 4]]`), or a copy of a matrix.
     * @param value The rows, or a matrix.
     */
    public matrix(value: MatrixValue): Matrix {
        return value instanceof Matrix ? value.clone() : matrixOf(value)
    }

    /**
     * An equation: a formula with `=` parsed.
     * @param text The formula.
     */
    public equation(text: string): Equation {
        const formula: Expression | Equation | Inequality = this.parse(text)
        if (!(formula instanceof Equation)) throw new MathSyntaxException(`An equation (with =) is expected: ${text}`)
        return formula
    }

    /**
     * A scope over this one, its definitions added: they are used by the formulas parsed by it, and replace the ones
     * of the same name.
     * @param definitions A body by signature: `{'h(x)': 'f(x) + 1'}`.
     */
    public with(definitions: MathDefinitions): MathScope {
        return new MathScope(this.context.derive(definitions))
    }

    /**
     * The solutions of a system of linear equations: none (an empty array), or one, with the values of the variables
     * it determines.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     */
    public solve(equations: SystemEquation[], variables: string[]): SystemSolution[] {
        return this.#solutions(this.context.run<LinearResult>('solveLinear', this.#system(equations, variables)))
    }

    /**
     * `solve()` in the threads of the addon.
     * @param equations The equations: formulas, equations, or expressions equal to zero.
     * @param variables The variables to solve for.
     * @param options Its cancellation, its time limit.
     */
    public async solveAsync(equations: SystemEquation[], variables: string[], options?: AsyncOptions): Promise<SystemSolution[]> {
        return this.#solutions(await this.context.runAsync<LinearResult>('solveLinear', this.#system(equations, variables), options))
    }

    /**
     * The common subexpressions of expressions (common subexpression elimination): the parts met more than once,
     * named, and the expressions rewritten with them. Printed with `toJavaScript()` or `toC()`, the result is code that
     * computes each part only once.
     * @param expressions The expressions: expressions, numbers or formulas.
     * @param options The prefix of the names.
     * @example
     * ```typescript
     * import {math} from '@lakutata/math'
     *
     * function shared(): string {
     *     const {replacements, expressions} = math.cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
     *     //x0 = x + y; the expressions: x0 + sin(x0)^2, cos(x0)
     *     const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)
     *     return [...lines, `return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`].join('\n')
     * }
     * ```
     */
    public cse(expressions: Value[], options?: CseOptions): CommonSubexpressions {
        return this.#common(this.context.run<NativeCommon>('cse', this.#cseArguments(expressions, options)))
    }

    /**
     * `cse()` in the threads of the addon.
     * @param expressions The expressions: expressions, numbers or formulas.
     * @param options The prefix of the names, the cancellation, the time limit.
     */
    public async cseAsync(expressions: Value[], options?: CseOptions & AsyncOptions): Promise<CommonSubexpressions> {
        return this.#common(await this.context.runAsync<NativeCommon>('cse', this.#cseArguments(expressions, options), options))
    }

    #cseArguments(expressions: Value[], options?: CseOptions): [Handle[], string] {
        if (!Array.isArray(expressions)) throw new MathArgumentException('The expressions are an array')
        return [expressions.map((expression: Value): Handle => handleOf(this.context, expression)), options?.prefix ?? 'x']
    }

    #common(result: NativeCommon): CommonSubexpressions {
        return {
            replacements: result.replacements.map(({name, value}): {name: string, value: Expression} => ({name: name, value: new Expression(this.context, value)})),
            expressions: result.expressions.map((handle: Handle): Expression => new Expression(this.context, handle))
        }
    }

    #system(equations: SystemEquation[], variables: string[]): [Handle[], string[]] {
        if (!Array.isArray(equations) || !Array.isArray(variables)) throw new MathArgumentException('The equations and the variables are arrays')
        return [equations.map((equation: SystemEquation): Handle => equationHandleOf(this.context, equation)), variables]
    }

    #solutions(result: LinearResult): SystemSolution[] {
        if (result.kind === 'empty') return []
        const solution: SystemSolution = {}
        for (const [name, value] of Object.entries(result.values)) solution[name] = new Expression(this.context, value)
        return [solution]
    }
}

/**
 * The common subexpressions, as the addon gives them
 */
interface NativeCommon {
    replacements: {name: string, value: Handle}[]
    expressions: Handle[]
}

/**
 * The solution of a linear system, as the addon gives it
 */
interface LinearResult {
    kind: 'finite' | 'empty'
    values: Record<string, Handle>
}

/**
 * A scope of definitions and settings (`MathScope`) with these options: the package exports the one made with the
 * default options, `math`, and its functions (`expression()`, `linalg`…). Its options are checked
 * (`MathArgumentException`).
 * @param options Its definitions, the precision of its decimals, the time limit and the concurrency of its
 * asynchronous operations: all of them have a default value.
 * @example
 * ```typescript
 * import {createMath, type MathScope} from '@lakutata/math'
 *
 * const finance: MathScope = createMath({definitions: {'vat(x)': 'x * 0.2'}, precision: 40, timeout: 5000})
 * console.log(finance.expression('vat(150)').toNumber())                  //30
 * ```
 */
export function createMath(options: MathOptions = {}): MathScope {
    if (typeof options !== 'object' || options === null) throw new MathArgumentException('The options are an object')
    const precision: number = options.precision ?? 32, timeout: number = options.timeout ?? 0
    if (!Number.isInteger(precision) || precision < 1 || precision > 100000) throw new MathArgumentException('The precision is an integer from 1 to 100000')
    if (typeof timeout !== 'number' || !(timeout >= 0)) throw new MathArgumentException('The time limit is a number of milliseconds, 0 or more')
    const concurrency: number = options.concurrency ?? native.versions().threads
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new MathArgumentException('The concurrency is an integer of 1 or more')
    const definitions: MathDefinitions = options.definitions ?? {}
    if (typeof definitions !== 'object' || definitions === null || Object.values(definitions).some((body: unknown): boolean => typeof body !== 'string' && typeof body !== 'number')) {
        throw new MathArgumentException('The definitions are an object of bodies (strings or numbers) by signature')
    }
    const scope: Handle = nativeCall((addon) => addon.scope(null, definitionsOf(definitions)))
    return new MathScope(new Context(scope, {precision: precision, timeout: timeout, concurrency: concurrency}, new AsyncTracker(concurrency)))
}
