import type {AsyncOptions} from './Context.js'
import type {Decimal, DecimalOptions, DecimalValue} from './Decimal.js'
import type {Equation, Expression, Inequality, Value} from './Expression.js'
import type {LinearAlgebra} from './LinearAlgebra.js'
import type {Matrix, MatrixValue} from './Matrix.js'
import {type CommonSubexpressions, createMath, type CseOptions, type MathScope, type SystemEquation, type SystemSolution} from './MathScope.js'
import type {NumberTheory} from './NumberTheory.js'
import type {Numeric} from './Numeric.js'
import type {Statistics} from './Statistics.js'

/**
 * The scope made with the default options (no definitions, decimals of 32 digits, no time limit, all the threads of the
 * addon): the functions exported by the package belong to it. `createMath()` makes others.
 * @example
 * ```typescript
 * import {math} from '@lakutata/math'
 *
 * console.log(math.expression('(x + 1)^2').expand().toString())   //x^2 + 2x + 1
 * console.log(math.with({'f(x)': 'x^3'}).expression('f(2)').toString()) //8
 * ```
 */
export const math: MathScope = createMath()

/**
 * Parse a formula: an expression (`x^2 - 5x + 6`), an equation (`x^2 = 4`) or an inequality (`x^2 < 4`). The one of
 * `math`.
 * @param text The formula.
 * @example
 * ```typescript
 * import {parse} from '@lakutata/math'
 *
 * console.log(parse('x^2 = 4').toString())                        //x^2 = 4
 * ```
 */
export function parse(text: string): Expression | Equation | Inequality {
    return math.parse(text)
}

/**
 * An expression: a formula parsed (an equation is an error), or the exact value of a number (`0.1` is `1/10`). The one
 * of `math`.
 * @param value The formula, or the number.
 * @example
 * ```typescript
 * import {expression} from '@lakutata/math'
 *
 * console.log(expression('sin(x)^2').diff('x').toString())        //2cos(x)*sin(x)
 * console.log(expression(0.1).toString())                         //1/10
 * ```
 */
export function expression(value: Value): Expression {
    return math.expression(value)
}

/**
 * An equation: a formula with `=` parsed. The one of `math`.
 * @param text The formula.
 * @example
 * ```typescript
 * import {equation} from '@lakutata/math'
 *
 * console.log(equation('x^2 - 5x + 6 = 0').solve('x').map(String)) //['2', '3']
 * ```
 */
export function equation(text: string): Equation {
    return math.equation(text)
}

/**
 * A decimal of a precision (32 significant digits by default): a value rounded to that many digits (halves to even).
 * The one of `math`.
 * @param value A decimal number (a number, a bigint, a string, a decimal) or an expression without variables.
 * @param options The precision.
 * @example
 * ```typescript
 * import {decimal} from '@lakutata/math'
 *
 * console.log(decimal('0.1').add('0.2').toString())               //0.3
 * console.log(decimal(2, {precision: 50}).sqrt().toString())      //1.4142135623730950488016887242096980785696718753769
 * ```
 */
export function decimal(value: DecimalValue | Expression, options?: DecimalOptions): Decimal {
    return math.decimal(value, options)
}

/**
 * A matrix of numbers: of its rows (`[[1, 2], [3, 4]]`), or a copy of a matrix. The one of `math`.
 * @param value The rows, or a matrix.
 * @example
 * ```typescript
 * import {matrix} from '@lakutata/math'
 *
 * console.log(matrix([[4, 1], [2, 3]]).transpose().toString())    //[4, 2; 1, 3]
 * ```
 */
export function matrix(value: MatrixValue): Matrix {
    return math.matrix(value)
}

/**
 * The solutions of a system of linear equations: none (an empty array), or one, with the values of the variables it
 * determines. The one of `math`.
 * @param equations The equations: formulas, equations, or expressions equal to zero.
 * @param variables The variables to solve for.
 * @example
 * ```typescript
 * import {solve} from '@lakutata/math'
 *
 * console.log(solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])[0].x.toString()) //2
 * ```
 */
export function solve(equations: SystemEquation[], variables: string[]): SystemSolution[] {
    return math.solve(equations, variables)
}

/**
 * `solve()` in the threads of the addon. The one of `math`.
 * @param equations The equations: formulas, equations, or expressions equal to zero.
 * @param variables The variables to solve for.
 * @param options Its cancellation, its time limit.
 * @example
 * ```typescript
 * import {solveAsync} from '@lakutata/math'
 *
 * const [solution] = await solveAsync(['x + y = 3', 'x - y = 1'], ['x', 'y'], {timeout: 1000})
 * console.log(solution.y.toString())                              //1
 * ```
 */
export async function solveAsync(equations: SystemEquation[], variables: string[], options?: AsyncOptions): Promise<SystemSolution[]> {
    return await math.solveAsync(equations, variables, options)
}

/**
 * The common subexpressions of expressions (common subexpression elimination): the parts met more than once, named,
 * and the expressions rewritten with them. The one of `math`.
 * @param expressions The expressions: expressions, numbers or formulas.
 * @param options The prefix of the names.
 * @example
 * ```typescript
 * import {cse} from '@lakutata/math'
 *
 * const {replacements, expressions} = cse(['sin(x + y)^2', 'cos(x + y)'])
 * console.log(replacements.map(({name, value}) => `${name} = ${value}`)) //['x0 = x + y']
 * console.log(expressions.map(String))                            //['sin(x0)^2', 'cos(x0)']
 * ```
 */
export function cse(expressions: Value[], options?: CseOptions): CommonSubexpressions {
    return math.cse(expressions, options)
}

/**
 * `cse()` in the threads of the addon. The one of `math`.
 * @param expressions The expressions: expressions, numbers or formulas.
 * @param options The prefix of the names, the cancellation, the time limit.
 * @example
 * ```typescript
 * import {cseAsync} from '@lakutata/math'
 *
 * const {replacements, expressions} = await cseAsync(['sin(x + y) + cos(x + y)'], {prefix: 't', timeout: 1000})
 * console.log(replacements.map(({name, value}) => `${name} = ${value}`)) //['t0 = x + y']
 * console.log(expressions.map(String))                            //['cos(t0) + sin(t0)']
 * ```
 */
export async function cseAsync(expressions: Value[], options?: CseOptions & AsyncOptions): Promise<CommonSubexpressions> {
    return await math.cseAsync(expressions, options)
}

/**
 * The number theory of the integers (bigints) of `math`: primes, factorization, modular arithmetic, integer sequences,
 * combinatorial numbers and counting.
 * @example
 * ```typescript
 * import {ntheory} from '@lakutata/math'
 *
 * console.log(ntheory.factor(360))         //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
 * ```
 */
export const ntheory: NumberTheory = math.ntheory

/**
 * The numeric linear algebra of `math` (on Eigen).
 * @example
 * ```typescript
 * import {linalg} from '@lakutata/math'
 *
 * console.log(linalg.solve([[4, 1], [2, 3]], [5, 5]))            //Float64Array [1, 1]
 * ```
 */
export const linalg: LinearAlgebra = math.linalg

/**
 * The statistics and the probability distributions of `math`.
 * @example
 * ```typescript
 * import {stats} from '@lakutata/math'
 *
 * console.log(stats.mean([2, 4, 4, 4, 5, 5, 7, 9]))               //5
 * console.log(stats.normal().cdf(0))                             //0.5
 * ```
 */
export const stats: Statistics = math.stats

/**
 * The numeric solutions of equations of `math`: the roots of polynomials, of a function, of a system of equations.
 * @example
 * ```typescript
 * import {numeric} from '@lakutata/math'
 *
 * console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root) //0.7390851332151606
 * ```
 */
export const numeric: Numeric = math.numeric
