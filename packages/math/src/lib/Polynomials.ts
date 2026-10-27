import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {Expression, handleOf, type Value} from './Expression.js'
import {type Handle} from './Native.js'

//The result of an operation of polynomials in the addon
interface NativePolyResult {
    expression?: Handle
    expressions: Handle[]
    numbers: number[]
    text: string
}

/**
 * The polynomials: their greatest common divisor, least common multiple, resultant and discriminant. It is
 * `MathScope.poly`; the package exports the one of `math` as `poly`.
 *
 * A polynomial is an expression, or a formula of one. Its generators are its symbols and its factors that are not
 * polynomials themselves: `sin(x)`, `sqrt(2)`, `x^(1/2)` (`x^(3/2)` is its cube), `exp(x)` (`exp(2x)` is its square).
 * They are independent of each other: `sqrt(2)^2` is not read as 2, nor `x` as the square of `sqrt(x)`. An expression
 * with a negative power, or with a coefficient that is complex or not exact, is not a polynomial
 * (`MathNotSupportedException`).
 *
 * The results are over the integers when every coefficient is an integer, with the gcd of the contents in a gcd
 * (`gcd(2x + 2, 4x + 4)` is `2x + 2`), over the rationals otherwise (monic: `gcd(x/2 + 1/2, x + 1)` is `x + 1`), their
 * leading coefficients positive, as SymPy's. Numbers alone have the gcd and the lcm of numbers (`gcd(1/2, 1/3)` is
 * `1/6`).
 * @example
 * ```typescript
 * import {poly} from '@lakutata/math'
 *
 * console.log(poly.gcd('x^4 - 1', 'x^6 - 1').toString())             //x^2 - 1
 * console.log(poly.lcm('2x + 2', '4x - 4').toString())                //4x^2 - 4
 * console.log(poly.resultant('x^2 + y', 'x - y', 'x').toString())     //y^2 + y
 * console.log(poly.discriminant('a*x^2 + b*x + c', 'x').toString())  //-4a*c + b^2
 * ```
 */
export class Polynomials {

    /**
     * The polynomials of a context. Made by `MathScope.poly`.
     * @param context The context of the formulas: its definitions, its settings.
     */
    constructor(protected readonly context: Context) {
    }

    #handles(values: readonly Value[]): Handle[] {
        if (!Array.isArray(values)) throw new MathArgumentException('The polynomials are an array of expressions')
        return values.map((value: Value): Handle => handleOf(this.context, value))
    }

    #expression(result: NativePolyResult): Expression {
        return new Expression(this.context, result.expression!)
    }

    #run(operation: string, values: readonly Value[], names: string[] = []): Expression {
        return this.#expression(this.context.run<NativePolyResult>('poly', [operation, this.#handles(values), names]))
    }

    async #runAsync(operation: string, values: readonly Value[], names: string[], options?: AsyncOptions): Promise<Expression> {
        return this.#expression(await this.context.runAsync<NativePolyResult>('poly', [operation, this.#handles(values), names], options))
    }

    #variable(variable: string): string[] {
        if (typeof variable !== 'string') throw new MathArgumentException('The variable is a name')
        return [variable]
    }

    /**
     * The greatest common divisor of polynomials: `gcd('x^4 - 1', 'x^6 - 1')` is `x^2 - 1`. Of one polynomial, the
     * polynomial itself with a positive leading coefficient; of 0 and 0, 0.
     * @param values The polynomials, at least one.
     */
    public gcd(...values: Value[]): Expression {
        return this.#run('gcd', values)
    }

    /**
     * `gcd()` in the threads of the addon.
     * @param values The polynomials, at least one.
     * @param options Its cancellation, its time limit.
     */
    public async gcdAsync(values: Value[], options?: AsyncOptions): Promise<Expression> {
        return await this.#runAsync('gcd', values, [], options)
    }

    /**
     * The least common multiple of polynomials: `lcm('2x + 2', '4x - 4')` is `4x^2 - 4`; 0 when one of them is 0.
     * @param values The polynomials, at least one.
     */
    public lcm(...values: Value[]): Expression {
        return this.#run('lcm', values)
    }

    /**
     * `lcm()` in the threads of the addon.
     * @param values The polynomials, at least one.
     * @param options Its cancellation, its time limit.
     */
    public async lcmAsync(values: Value[], options?: AsyncOptions): Promise<Expression> {
        return await this.#runAsync('lcm', values, [], options)
    }

    /**
     * The resultant of two polynomials in a variable: 0 when they have a common root, a polynomial in their other
     * generators otherwise (`resultant('x^2 + y', 'x - y', 'x')` is `y^2 + y`).
     * @param a The first polynomial.
     * @param b The second polynomial.
     * @param variable The variable.
     */
    public resultant(a: Value, b: Value, variable: string): Expression {
        return this.#run('resultant', [a, b], this.#variable(variable))
    }

    /**
     * `resultant()` in the threads of the addon.
     * @param a The first polynomial.
     * @param b The second polynomial.
     * @param variable The variable.
     * @param options Its cancellation, its time limit.
     */
    public async resultantAsync(a: Value, b: Value, variable: string, options?: AsyncOptions): Promise<Expression> {
        return await this.#runAsync('resultant', [a, b], this.#variable(variable), options)
    }

    /**
     * The discriminant of a polynomial in a variable, `(-1)^(n(n - 1)/2) resultant(p, p')/lc(p)` for the degree n:
     * `b^2 - 4a*c` for `a*x^2 + b*x + c`; 0 for a polynomial of degree 0.
     * @param p The polynomial.
     * @param variable The variable.
     */
    public discriminant(p: Value, variable: string): Expression {
        return this.#run('discriminant', [p], this.#variable(variable))
    }

    /**
     * `discriminant()` in the threads of the addon.
     * @param p The polynomial.
     * @param variable The variable.
     * @param options Its cancellation, its time limit.
     */
    public async discriminantAsync(p: Value, variable: string, options?: AsyncOptions): Promise<Expression> {
        return await this.#runAsync('discriminant', [p], this.#variable(variable), options)
    }
}
