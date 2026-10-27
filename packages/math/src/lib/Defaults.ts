import type {AsyncOptions} from './Context.js'
import type {Decimal, DecimalOptions, DecimalValue} from './Decimal.js'
import type {Equation, Expression, Inequality, Value} from './Expression.js'
import type {ExpressionMatrix, ExpressionMatrixValue} from './ExpressionMatrix.js'
import type {LinearAlgebra} from './LinearAlgebra.js'
import type {Matrix, MatrixValue} from './Matrix.js'
import {type CommonSubexpressions, createMath, type CseOptions, type MathScope, type SystemEquation, type SystemSolution} from './MathScope.js'
import type {IntervalOptions, MathSet} from './MathSet.js'
import type {NumberTheory} from './NumberTheory.js'
import type {Numeric} from './Numeric.js'
import type {Polynomials} from './Polynomials.js'
import type {Statistics} from './Statistics.js'
import type {Unit, UnitValue} from './Unit.js'
import type {PhysicalConstant} from './UnitTable.js'

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
export function parse(text: string): Expression | Equation | Inequality | ExpressionMatrix {
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
 * A value with units: of a formula of units, or of a number and its units. The one of `math`.
 * @param value The formula of units (`'5 cm + 2 inch'`), or the number.
 * @param units The units of the number (`'m/s^2'`).
 * @example
 * ```typescript
 * import {unit} from '@lakutata/math'
 *
 * console.log(unit('5 cm + 2 inch').to('mm').toString())                 //100.8 mm
 * console.log(unit(60, 'mi/h').toNumber('km/h'))                          //96.56064
 * console.log(unit('3 m * 4 m').toString())                                //12 m^2
 * ```
 */
export function unit(value: UnitValue, units?: string): Unit {
    return math.unit(value, units)
}

/**
 * A physical constant with its units: of CODATA 2022, the exact ones as their formulas. The one of `math`.
 * @param name The name of the constant.
 * @example
 * ```typescript
 * import {constant} from '@lakutata/math'
 *
 * console.log(constant('speedOfLight').toString())                         //299792458 m / s
 * console.log(constant('boltzmann').mul('300 K').to('eV').toDecimal(6))  //0.025852 eV
 * ```
 */
export function constant(name: PhysicalConstant): Unit {
    return math.constant(name)
}

/**
 * A matrix of expressions: of its rows, of a formula of a matrix, or of a matrix of numbers. The one of `math`.
 * @param value The rows, the formula, or the matrix.
 * @example
 * ```typescript
 * import {expressionMatrix} from '@lakutata/math'
 *
 * console.log(expressionMatrix([['a', 'b'], ['c', 'd']]).determinant().toString()) //a*d - b*c
 * console.log(expressionMatrix('[1, 2; 3, 4]').inverse().toString())       //[-2, 1; 3/2, -1/2]
 * ```
 */
export function expressionMatrix(value: ExpressionMatrixValue): ExpressionMatrix {
    return math.expressionMatrix(value)
}

/**
 * An interval of real numbers, of exact ends. The one of `math`.
 * @param start The start (`-inf` for none).
 * @param end The end (`inf` for none).
 * @param options Whether the ends are excluded (both included by default).
 * @example
 * ```typescript
 * import {interval} from '@lakutata/math'
 *
 * const set = interval('-sqrt(2)', 'sqrt(2)', {startOpen: true})
 * console.log(set.toString(), set.contains('7/5'))                 //(-sqrt(2), sqrt(2)] true
 * console.log(set.intersect(interval(0, 'inf')).toString())        //[0, sqrt(2)]
 * ```
 */
export function interval(start: Value, end: Value, options?: IntervalOptions): MathSet {
    return math.interval(start, end, options)
}

/**
 * A finite set of values. The one of `math`.
 * @param values The values.
 * @example
 * ```typescript
 * import {finiteSet} from '@lakutata/math'
 *
 * console.log(finiteSet([3, 1, 'sqrt(2)', 1]).toString())          //{1, sqrt(2), 3}
 * ```
 */
export function finiteSet(values: readonly Value[]): MathSet {
    return math.finiteSet(values)
}

/**
 * The Jacobian matrix of expressions by variables: a row for each expression. The one of `math`.
 * @param expressions The expressions (or formulas).
 * @param variables The variables.
 * @example
 * ```typescript
 * import {jacobian} from '@lakutata/math'
 *
 * console.log(jacobian(['x^2*y', 'x + sin(y)'], ['x', 'y']).toString())    //[2x*y, x^2; 1, cos(y)]
 * ```
 */
export function jacobian(expressions: Value[], variables: string[]): ExpressionMatrix {
    return math.jacobian(expressions, variables)
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
 * combinatorial numbers, counting and continued fractions.
 * @example
 * ```typescript
 * import {ntheory} from '@lakutata/math'
 *
 * console.log(ntheory.factor(360))         //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
 * ```
 */
export const ntheory: NumberTheory = math.ntheory

/**
 * The polynomials of `math`: their greatest common divisor, least common multiple, resultant and discriminant.
 * @example
 * ```typescript
 * import {poly} from '@lakutata/math'
 *
 * console.log(poly.gcd('x^2 - 1', 'x^2 + 2x + 1').toString())        //x + 1
 * ```
 */
export const poly: Polynomials = math.poly

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
 * The numeric solutions of equations, the integrals and the differential equations of `math`: the roots of
 * polynomials, of a function, of a system of equations; the integral of a function; the solution of ordinary
 * differential equations.
 * @example
 * ```typescript
 * import {numeric} from '@lakutata/math'
 *
 * console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root) //0.7390851332151606
 * ```
 */
export const numeric: Numeric = math.numeric
