import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathSyntaxException} from '../exceptions/MathSyntaxException.js'
import type {AsyncOptions, Context} from './Context.js'
import {Decimal} from './Decimal.js'
import {MathSet, type SetInterval} from './MathSet.js'
import {type Handle, nativeCall, type NativeParsed, type NativeSolutions} from './Native.js'

/**
 * A value given where an expression is expected: an expression, a number (exact: `0.1` is `1/10`), a decimal (exact),
 * a formula
 */
export type Value = Expression | Decimal | number | bigint | string

/**
 * The side of a finite point a limit is taken from: above (`'+'`), below (`'-'`) or both, the same limit (`'both'`, the
 * default)
 */
export interface LimitOptions {
    /**
     * The side: `'both'` by default.
     */
    direction?: '+' | '-' | 'both'
}

/**
 * The domain of the solutions of an equation: the complex numbers (the default) or the real ones
 */
export interface SolveOptions {
    /**
     * `'complex'` (the default): every solution; `'real'`: the real ones.
     */
    domain?: 'complex' | 'real'
}

/**
 * A formula compiled into a function of numbers: called with the values of its variables, in their order
 */
export interface CompiledFunction {
    /**
     * The value of the formula for the values of its variables.
     * @param values The values, in the order of `variables`.
     */
    (...values: number[]): number

    /**
     * The variables, in the order of the values.
     */
    readonly variables: readonly string[]

    /**
     * The values of the formula for rows of values, in one call: `inputs` holds the rows one after the other.
     * @param inputs The values, `variables.length` by row.
     */
    batch(inputs: Float64Array): Float64Array
}

/**
 * The polar form of an expression: `z = modulus * e^(i*argument)`
 */
export interface PolarForm {
    /**
     * The modulus: `abs(z)`.
     */
    modulus: Expression
    /**
     * The argument: `arg(z)`, from -pi (excluded) to pi (included).
     */
    argument: Expression
}

/**
 * The rectangular form of an expression: `z = real + i*imaginary`
 */
export interface RectangularForm {
    /**
     * The real part: `re(z)`.
     */
    real: Expression
    /**
     * The imaginary part: `im(z)`.
     */
    imaginary: Expression
}

/**
 * The handle of a value in a context: an expression's own, a number's exact value, a formula parsed
 * @param context
 * @param value
 */
export function handleOf(context: Context, value: Value): Handle {
    if (value instanceof Expression) return value.handle
    if (value instanceof Decimal) return expressionOf(context, value.toString()).handle
    if (typeof value === 'number') return nativeCall((native) => native.number(value))
    if (typeof value === 'bigint') return expressionOf(context, value.toString()).handle
    if (typeof value === 'string') return expressionOf(context, value).handle
    throw new MathArgumentException('Not an expression, a number, a decimal or a formula')
}

/**
 * The expression of a formula (an equation, an inequality or a matrix is an error)
 * @param context
 * @param text
 */
export function expressionOf(context: Context, text: string): Expression {
    const parsed: NativeParsed = parsedOf(context, text)
    if (parsed.kind !== 'expression') throw new MathSyntaxException(`An expression is expected, not ${parsed.kind === 'equation' ? 'an equation' : parsed.kind === 'matrix' ? 'a matrix' : 'an inequality'}: ${text}`)
    return new Expression(context, parsed.left)
}

/**
 * A formula parsed by the addon: an expression, an equation, an inequality or a matrix
 * @param context
 * @param text
 */
export function parsedOf(context: Context, text: string): NativeParsed {
    return nativeCall((native) => native.parse(context.scope, text))
}

/**
 * The expression, the equation or the inequality of a formula parsed (not a matrix)
 * @param context
 * @param parsed
 */
export function formulaOf(context: Context, parsed: NativeParsed): Expression | Equation | Inequality {
    const left: Expression = new Expression(context, parsed.left)
    if (parsed.kind === 'expression') return left
    const right: Expression = new Expression(context, parsed.right!)
    if (parsed.kind === 'equation') return new Equation(left, right)
    return new Inequality(left, right, parsed.relation as InequalityRelation)
}

/**
 * The values of the variables, as the addon takes them: [name, handle] pairs
 * @param context
 * @param values
 */
function valuesOf(context: Context, values: Record<string, Value>): [string, Handle][] {
    return Object.entries(values).map(([name, value]: [string, Value]): [string, Handle] => [name, handleOf(context, value)])
}

/**
 * The solutions of an addon's result, in a context
 * @param context
 * @param found
 */
function solutionsOf(context: Context, found: NativeSolutions): Solutions {
    const values: Expression[] = found.values.map((value: Handle): Expression => new Expression(context, value))
    const intervals: SetInterval[] = found.intervals.map((interval): SetInterval => ({
        start: new Expression(context, interval.start),
        end: new Expression(context, interval.end),
        startOpen: interval.startOpen,
        endOpen: interval.endOpen
    }))
    const kind = {finite: 'finite', empty: 'empty', all: 'all', intervals: 'intervals', unsolved: 'other', other: 'other'} as const
    const solutions: Solutions = new Solutions(found.kind, new MathSet(context, values, intervals, kind[found.kind], found.text), found.text)
    solutions.push(...values)
    return solutions
}

/**
 * The context of an expression, for the formulas made of it
 * @param expression
 */
function contextOf(expression: Expression): Context {
    return (expression as unknown as {context: Context}).context
}

/**
 * An expression: immutable, each operation gives a new one. Its numbers are exact (`0.1 + 0.2` is `3/10`,
 * `sin(pi/6)` is `1/2`) until they are asked as numbers or decimals.
 * @example
 * ```typescript
 * import {math} from '@lakutata/math'
 *
 * async function example(): Promise<void> {
 *     const expression = math.expression('x^2 - 5x + 6')
 *     console.log(expression.diff('x').toString())               //2x - 5
 *     console.log(expression.substitute({x: 4}).toNumber())       //2
 *     console.log(math.expression('sqrt(2)').toDecimal(30))       //1.41421356237309504880168872421
 *     console.log((await expression.expandAsync()).toTeX())       //x^{2} - 5 x + 6
 * }
 * ```
 */
export class Expression {

    /**
     * An expression of the addon in a context. Made by `expression()`, `parse()` and by the operations.
     * @param context The context of the formulas: its definitions, its settings.
     * @param handle The native expression.
     */
    constructor(protected readonly context: Context, public readonly handle: Handle) {
    }

    #expression(handle: Handle): Expression {
        return new Expression(this.context, handle)
    }

    #poly(operation: string, names: string[] = []): Expression {
        return this.#expression(this.context.run<{expression: Handle}>('poly', [operation, [this.handle], names]).expression)
    }

    async #polyAsync(operation: string, names: string[], options?: AsyncOptions): Promise<Expression> {
        return this.#expression((await this.context.runAsync<{expression: Handle}>('poly', [operation, [this.handle], names], options)).expression)
    }

    /**
     * The formula of the expression, as the formulas are written: `x^2 - 5x + 6`. Parsed again, it gives the same
     * expression.
     */
    public toString(): string {
        return nativeCall((native) => native.text(this.handle))
    }

    /**
     * The formula of the expression, for `JSON.stringify()`.
     */
    public toJSON(): string {
        return this.toString()
    }

    /**
     * The LaTeX of the expression: `x^{2} - 5 x + 6`.
     */
    public toTeX(): string {
        return nativeCall((native) => native.tex(this.handle))
    }

    /**
     * The expression as JavaScript code, with the same variable names: `x^2 - 5x + 6` is `Math.pow(x, 2) - 5*x + 6`.
     * The code computes in double precision, with real numbers only: wherever part of the expression has a complex
     * value, the result is NaN (`compile()` computes it in the complex numbers), and the variables are real there, so
     * `re(x)` is `x`. A function JavaScript does not have (such as `gamma`, `erf`, `zeta`), a complex number such as
     * `2i`, or a variable whose name is a reserved word or a name the code uses (`new`, `Math`) throws
     * `MathNotSupportedException`.
     * @example
     * ```typescript
     * import {math} from '@lakutata/math'
     *
     * function code(): number {
     *     const f = new Function('x', 'y', `return ${math.expression('x^2 + sin(y)').toJavaScript()}`)
     *     return f(2, 0)                                           //4
     * }
     * ```
     */
    public toJavaScript(): string {
        return this.context.run<string>('code', [this.handle, 'javascript'])
    }

    /**
     * The expression as C code (C99 with `<math.h>`), its variables used by name as `double`s: `x^2 - 5x + 6` is
     * `pow(x, 2.0) - 5.0*x + 6.0`. Like `toJavaScript()`, it computes with real numbers only; C has `gamma`
     * (`tgamma`), `loggamma` and `erf`, but not `zeta` or `lambertw`.
     */
    public toC(): string {
        return this.context.run<string>('code', [this.handle, 'c'])
    }

    /**
     * The polar form of the expression: its modulus and its argument (`5` and `atan(4/3)` for `3 + 4i`, `1` and `pi/3`
     * for `e^(i*pi/3)`). The variables are complex numbers: the form of `x` is `abs(x)` and `arg(x)`.
     */
    public toPolar(): PolarForm {
        const [modulus, argument]: Handle[] = this.context.run<Handle[]>('polar', [this.handle])
        return {modulus: this.#expression(modulus), argument: this.#expression(argument)}
    }

    /**
     * The rectangular form of the expression: its real part and its imaginary part (`1/2` and `sqrt(3)/2` for
     * `e^(i*pi/3)`). The variables are complex numbers: the parts of `(1 + i)*x` are `-im(x) + re(x)` and
     * `im(x) + re(x)`.
     */
    public toRectangular(): RectangularForm {
        const [real, imaginary]: Handle[] = this.context.run<Handle[]>('rectangular', [this.handle])
        return {real: this.#expression(real), imaginary: this.#expression(imaginary)}
    }

    /**
     * The value of an expression without variables as a number of JavaScript (a double). It is computed from the
     * decimals of the value, as `toComplex()`, so that all its digits are right, also where doubles have none
     * (`cos(10^30)`). A complex value throws `MathDomainException`, whatever the size of its imaginary part
     * (`1 + i/10^15`): use `toComplex()`. So does a division by a value not shown to differ from 0
     * (`1/(ln(6) - ln(2) - ln(3))`).
     */
    public toNumber(): number {
        return nativeCall((native) => native.toNumber(this.handle))
    }

    /**
     * The value of an expression without variables as a complex number: from its decimals where `toComplexDecimal()`
     * computes them, so that all its digits are right (`e^(i*10^30)`); in doubles otherwise (the special functions of
     * complex arguments), the parts the decimals compute given to them.
     */
    public toComplex(): { re: number, im: number } {
        const [re, im]: [number, number] = nativeCall((native) => native.toComplex(this.handle))
        return {re: re, im: im}
    }

    /**
     * The value of an expression without variables as a decimal of a number of significant digits, as a string
     * (`3.14159265358979323846`), correctly rounded: it is computed again with more digits until two results agree. It
     * is written as `Decimal.toString()` writes its digits, without trailing zeros (`3`, `1e+25`). A value that cannot
     * be told from 0, even with 640 more digits, is `0` (`ln(6) - ln(2) - ln(3)`); a value exactly halfway between two
     * decimals of that many digits is rounded to the even one; a rounding function at a jump within the error of its
     * argument takes the value of the jump (`floor(ln(8)/ln(2))` is 3). A value whose argument is too large for the
     * digits is computed with as many more digits as it needs, up to 50000 (`sin(10^(10^4))` needs 10^4): beyond, it
     * throws `MathNotSupportedException`.
     * It computes the arithmetic, powers and roots, `exp` and `ln`, the trigonometric and hyperbolic functions and
     * their inverses, the rounding functions, `pi`, `e`, `phi`, `EulerGamma` and `Catalan`, and the special functions
     * (`gamma`, `loggamma`, `digamma`, `polygamma`, `beta`, `erf`, `erfc`, `zeta`, `lowergamma`, `uppergamma`,
     * `lambertw`), of real values. A real value with complex parts (`e^(i*pi)`, `-i*asinh(i)`) is the real part of
     * `toComplexDecimal()`; a complex value throws `MathDomainException`.
     * @param digits The significant digits: the `precision` of the scope by default.
     */
    public toDecimal(digits?: number): string {
        return this.context.run<string>('decimal', [this.handle, digits ?? this.context.settings.precision])
    }

    /**
     * `toDecimal()` in the threads of the addon.
     * @param digits The significant digits: the `precision` of the scope by default.
     * @param options Its cancellation, its time limit.
     */
    public async toDecimalAsync(digits?: number, options?: AsyncOptions): Promise<string> {
        return await this.context.runAsync<string>('decimal', [this.handle, digits ?? this.context.settings.precision], options)
    }

    /**
     * The value of an expression without variables as a complex number, each part a decimal of a number of significant
     * digits, correctly rounded as `toDecimal()` rounds: `e^(i*10^30)` has the digits of `cos(10^30)` and `sin(10^30)`.
     * A part that cannot be told from 0, even with 640 more digits, is `0`; a real value has the imaginary part `0`. The
     * functions of `toDecimal()` take complex arguments too, with their principal branches (on a branch cut, the side
     * SymPy takes), but for the special functions, which take real arguments only.
     * @param digits The significant digits of each part: the `precision` of the scope by default.
     */
    public toComplexDecimal(digits?: number): { re: string, im: string } {
        const [re, im]: [string, string] = this.context.run<[string, string]>('complexDecimal', [this.handle, digits ?? this.context.settings.precision])
        return {re: re, im: im}
    }

    /**
     * `toComplexDecimal()` in the threads of the addon.
     * @param digits The significant digits of each part: the `precision` of the scope by default.
     * @param options Its cancellation, its time limit.
     */
    public async toComplexDecimalAsync(digits?: number, options?: AsyncOptions): Promise<{ re: string, im: string }> {
        const [re, im]: [string, string] = await this.context.runAsync<[string, string]>('complexDecimal', [this.handle, digits ?? this.context.settings.precision], options)
        return {re: re, im: im}
    }

    /**
     * The names of the variables of the expression, sorted.
     */
    public variables(): string[] {
        return nativeCall((native) => native.variables(this.handle))
    }

    /**
     * Whether the expression is equal to another one: their difference, expanded, put over one denominator (`(x^2 -
     * 1)/(x - 1)` equals `x + 1`) or simplified, is zero. `false` when that does not show it, even if they are equal.
     * @param other The other expression, a number or a formula.
     */
    public equals(other: Value): boolean {
        return this.context.run<boolean>('equals', [this.handle, handleOf(this.context, other)])
    }

    /**
     * The sum of the expression and another one.
     * @param other An expression, a number or a formula.
     */
    public add(other: Value): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['+', this.handle, handleOf(this.context, other)]))
    }

    /**
     * The difference of the expression and another one.
     * @param other An expression, a number or a formula.
     */
    public sub(other: Value): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['-', this.handle, handleOf(this.context, other)]))
    }

    /**
     * The product of the expression and another one.
     * @param other An expression, a number or a formula.
     */
    public mul(other: Value): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['*', this.handle, handleOf(this.context, other)]))
    }

    /**
     * The quotient of the expression by another one.
     * @param other An expression, a number or a formula.
     */
    public div(other: Value): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['/', this.handle, handleOf(this.context, other)]))
    }

    /**
     * The expression to a power.
     * @param exponent An expression, a number or a formula.
     */
    public pow(exponent: Value): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['^', this.handle, handleOf(this.context, exponent)]))
    }

    /**
     * The opposite of the expression.
     */
    public neg(): Expression {
        return this.#expression(this.context.run<Handle>('arithmetic', ['neg', this.handle, this.handle]))
    }

    /**
     * The expression expanded: its products and integer powers of sums distributed (`(x + 1)^2` is `x^2 + 2x + 1`).
     */
    public expand(): Expression {
        return this.#expression(this.context.run<Handle>('expand', [this.handle]))
    }

    /**
     * `expand()` in the threads of the addon.
     * @param options Its cancellation, its time limit.
     */
    public async expandAsync(options?: AsyncOptions): Promise<Expression> {
        return this.#expression(await this.context.runAsync<Handle>('expand', [this.handle], options))
    }

    /**
     * The expression in a shorter form, by identities that hold for all values of the variables; the expression itself
     * where no form is shorter. Shorter is fewer operations, as SymPy's `count_ops` counts them (each addition,
     * subtraction, product, division, sign, power and function), with ties broken by the shorter text. The forms tried:
     * the fraction cancelled or factored, the polynomial expanded; exponentials whose arguments are multiples of one
     * another, written as powers of a single exponential; sines and cosines (of multiples of one angle, sums of angles
     * expanded) reduced by `sin^2 + cos^2 = 1`, with double or half angles and tangents; the hyperbolic functions by
     * `cosh^2 - sinh^2 = 1`, and exchanged with exponentials; nested square roots of numbers taken apart, square roots of
     * numbers taken out of denominators; logarithms of positive rationals combined. The arguments of functions and the
     * values of piecewise expressions are simplified first; an expression with an integer power of a sum above 16, or a
     * power whose exponent has a numerator above 256, is not expanded. Nothing that depends on the signs of the
     * variables is done (`sqrt(x^2)` stays as it is).
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('(x^2 - 1)/(x - 1)').simplify().toString())   //x + 1
     * console.log(expression('sin(x)^4 - cos(x)^4').simplify().toString())  //-cos(2x)
     * console.log(expression('sqrt(3 + 2sqrt(2))').simplify().toString())   //sqrt(2) + 1
     */
    public simplify(): Expression {
        return this.#expression(this.context.run<Handle>('simplify', [this.handle]))
    }

    /**
     * `simplify()` in the threads of the addon.
     * @param options Its cancellation, its time limit.
     */
    public async simplifyAsync(options?: AsyncOptions): Promise<Expression> {
        return this.#expression(await this.context.runAsync<Handle>('simplify', [this.handle], options))
    }

    /**
     * The expression factored over the rationals: its irreducible factors to their powers, with its rational
     * coefficient in front (`6x^2 - 6` is `6(x - 1)(x + 1)`; `x^6 - y^6` has four factors); of a fraction, its
     * numerator and its denominator. Its generators are those of `math.poly` (`sin(x)^2 - 1` is `(sin(x) - 1)(sin(x) +
     * 1)`). An operation on the result gives the usual form of the formulas again (`2(x + 1)` plus 1 is `2x + 3`).
     */
    public factor(): Expression {
        return this.#poly('factor')
    }

    /**
     * `factor()` in the threads of the addon: a factorization in several variables can take long.
     * @param options Its cancellation, its time limit.
     */
    public async factorAsync(options?: AsyncOptions): Promise<Expression> {
        return this.#polyAsync('factor', [], options)
    }

    /**
     * The square-free decomposition: the product of the factors of each multiplicity, to that power (`x^3 - x^2 - x +
     * 1` is `(x + 1)(x - 1)^2`); of a fraction, of its numerator and its denominator.
     */
    public sqf(): Expression {
        return this.#poly('sqf')
    }

    /**
     * The expression as a fraction of polynomials with their gcd cancelled: its numerator and its denominator expanded,
     * with positive leading coefficients, and the sign in front (`(2x^2 - 2)/(x^2 - 2x + 1)` is `(2x + 2)/(x - 1)`,
     * `(-x - 1)/(x - 1)` is `-(x + 1)/(x - 1)`). Its generators are those of `math.poly`; a complex coefficient is not
     * supported (`MathNotSupportedException`).
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('(x^2 - 1)/(x^2 + 2x + 1)').cancel().toString()) //(x - 1)/(x + 1)
     */
    public cancel(): Expression {
        return this.#poly('cancel')
    }

    /**
     * `cancel()` in the threads of the addon: the gcd of large polynomials in several variables can take long.
     * @param options Its cancellation, its time limit.
     */
    public async cancelAsync(options?: AsyncOptions): Promise<Expression> {
        return this.#polyAsync('cancel', [], options)
    }

    /**
     * The expression over one denominator: the bases of the denominators to their greatest powers and the lcm of their
     * numbers (`1/(2x) + 1/(3y)` is `(2x + 3y)/(6x*y)`), the numerator expanded; no common factor of the numerator and
     * the denominator is looked for (that is `cancel()`). It goes into sums, products and powers, not into the
     * arguments of functions.
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('1/x + 1/(x + 1)').together().toString()) //(2x + 1)/(x*(x + 1))
     */
    public together(): Expression {
        return this.#poly('together')
    }

    /**
     * The partial fractions in a variable: the polynomial part, then, for each irreducible factor `q` of the
     * denominator to the power `k`, the fractions `h/q^j` (`j` from 1 to `k`) with numerators of lower degree than `q`,
     * each one factored (`1/(x^2 - 1)` is `-1/(2(x + 1)) + 1/(2(x - 1))`). The other variables are parameters; an
     * expression that is not a fraction of polynomials in the variable (`sin(x)/x`) is not supported
     * (`MathNotSupportedException`).
     * @param variable The variable.
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('(x^3 + 1)/(x^2 - x)').apart('x').toString()) //x - 1/x + 2/(x - 1) + 1
     */
    public apart(variable: string): Expression {
        return this.#poly('apart', [variable])
    }

    /**
     * `apart()` in the threads of the addon: it factors the denominator, which can take long.
     * @param variable The variable.
     * @param options Its cancellation, its time limit.
     */
    public async apartAsync(variable: string, options?: AsyncOptions): Promise<Expression> {
        return this.#polyAsync('apart', [variable], options)
    }

    /**
     * A polynomial of degree 2 in a variable, `a x^2 + b x + c`, as `a(x + b/(2a))^2 + c - b^2/(4a)`
     * (`2x^2 + 4x + 1` is `2(x + 1)^2 - 1`); another degree is not supported (`MathNotSupportedException`).
     * @param variable The variable.
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('x^2 - 6x + 10').completeSquare('x').toString()) //(x - 3)^2 + 1
     */
    public completeSquare(variable: string): Expression {
        return this.#poly('completeSquare', [variable])
    }

    /**
     * The derivative of the expression by a variable.
     * @param variable The variable.
     * @param times How many times it is derived: 1 by default.
     */
    public diff(variable: string, times: number = 1): Expression {
        return this.#expression(this.context.run<Handle>('diff', [this.handle, variable, times]))
    }

    /**
     * `diff()` in the threads of the addon.
     * @param variable The variable.
     * @param times How many times it is derived: 1 by default.
     * @param options Its cancellation, its time limit.
     */
    public async diffAsync(variable: string, times: number = 1, options?: AsyncOptions): Promise<Expression> {
        return this.#expression(await this.context.runAsync<Handle>('diff', [this.handle, variable, times], options))
    }

    /**
     * The limit of the expression for a variable going to a point, by Gruntz's algorithm: at a finite point from both
     * sides by default (two different limits throw `MathDomainException`), at `inf` or `-inf`; `inf` or `-inf` where
     * it diverges (`sin(x)/x` at 0 is 1, `(1 + 1/x)^x` at `inf` is `e`, `x^5 e^(-x)` at `inf` is 0); an oscillation
     * without a limit (`sin(x)` at `inf`) throws `MathDomainException`. A limit that depends on the sign of a parameter
     * (`exp(a*x)` at `inf`), or of a function whose behavior at infinity the algorithm does not know (`gamma(x + 1)/x` at
     * `inf`), or of a sum or a product left as a call, throws `MathNotSupportedException`.
     * @param variable The variable.
     * @param point The point: a number, an expression, `inf` or `-inf`.
     * @param options The side of a finite point the variable comes from.
     * @example
     * import {expression} from '@lakutata/math'
     *
     * console.log(expression('sin(x)/x').limit('x', 0).toString())         //1
     * console.log(expression('(1 + 1/x)^x').limit('x', 'inf').toString())  //e
     * console.log(expression('1/x').limit('x', 0, {direction: '-'}).toString()) //-inf
     */
    public limit(variable: string, point: Value, options: LimitOptions = {}): Expression {
        return this.#expression(this.context.run<Handle>('limit', [this.handle, variable, handleOf(this.context, point), options.direction ?? 'both']))
    }

    /**
     * `limit()` in the threads of the addon: Gruntz's algorithm computes series of series, which can take long.
     * @param variable The variable.
     * @param point The point.
     * @param options The side of the point, the cancellation, the time limit.
     */
    public async limitAsync(variable: string, point: Value, options: LimitOptions & AsyncOptions = {}): Promise<Expression> {
        return this.#expression(await this.context.runAsync<Handle>('limit', [this.handle, variable, handleOf(this.context, point), options.direction ?? 'both'], options))
    }

    /**
     * The series of the expression at a point: its terms of degree lower than `order` (`series('x', 0, 6)` of
     * `sin(x)` is `x^5/120 - x^3/6 + x`).
     * @param variable The variable.
     * @param point The point: 0 by default.
     * @param order The degree of the first term left out: 6 by default.
     */
    public series(variable: string, point: Value = 0, order: number = 6): Expression {
        return this.#expression(this.context.run<Handle>('series', [this.handle, variable, handleOf(this.context, point), order]))
    }

    /**
     * `series()` in the threads of the addon.
     * @param variable The variable.
     * @param point The point: 0 by default.
     * @param order The degree of the first term left out: 6 by default.
     * @param options Its cancellation, its time limit.
     */
    public async seriesAsync(variable: string, point: Value = 0, order: number = 6, options?: AsyncOptions): Promise<Expression> {
        return this.#expression(await this.context.runAsync<Handle>('series', [this.handle, variable, handleOf(this.context, point), order], options))
    }

    /**
     * The expression with variables replaced: by numbers (exact), expressions or formulas.
     * @param values The values, by the names of the variables.
     */
    public substitute(values: Record<string, Value>): Expression {
        return this.#expression(this.context.run<Handle>('substitute', [this.handle, valuesOf(this.context, values)]))
    }

    /**
     * The value of the expression for values of its variables: `substitute()`, the result exact (`toNumber()`,
     * `toDecimal()` give it as a number).
     * @param values The values, by the names of the variables.
     */
    public evaluate(values: Record<string, Value> = {}): Expression {
        return this.substitute(values)
    }

    /**
     * The solutions of `expression = 0` for a variable.
     * @param variable The variable.
     * @param options The domain of the solutions.
     */
    public solve(variable: string, options: SolveOptions = {}): Solutions {
        return solutionsOf(this.context, this.context.run<NativeSolutions>('solve', [this.handle, variable, options.domain === 'real']))
    }

    /**
     * `solve()` in the threads of the addon.
     * @param variable The variable.
     * @param options The domain of the solutions, the cancellation, the time limit.
     */
    public async solveAsync(variable: string, options: SolveOptions & AsyncOptions = {}): Promise<Solutions> {
        return solutionsOf(this.context, await this.context.runAsync<NativeSolutions>('solve', [this.handle, variable, options.domain === 'real'], options))
    }

    /**
     * The numerator of the expression written as one fraction: `numerator()` of `(x + 1)/(x - 1) + 1/y` is
     * `x + y*(x + 1) - 1`.
     */
    public numerator(): Expression {
        return this.#expression(this.context.run<Handle[]>('fraction', [this.handle])[0])
    }

    /**
     * The denominator of the expression written as one fraction: `y*(x - 1)` for `(x + 1)/(x - 1) + 1/y`.
     */
    public denominator(): Expression {
        return this.#expression(this.context.run<Handle[]>('fraction', [this.handle])[1])
    }

    /**
     * The coefficients of the expression as a polynomial in a variable, from the constant term up: the coefficient of
     * `variable^k` is at index `k` (`[5, -2, a, 3]` for `3x^3 + a*x^2 - 2x + 5`). The other variables may appear in
     * them. An expression that is not a polynomial in the variable (`1/x`, `sin(x)`) throws
     * `MathNotSupportedException`.
     * @param variable The variable.
     */
    public coefficients(variable: string): Expression[] {
        return this.context.run<Handle[]>('coefficients', [this.handle, variable]).map((handle: Handle): Expression => this.#expression(handle))
    }

    /**
     * The degree of the expression as a polynomial in a variable: `-Infinity` for 0. An expression that is not a
     * polynomial in the variable throws `MathNotSupportedException`.
     * @param variable The variable.
     */
    public degree(variable: string): number {
        const coefficients: Expression[] = this.coefficients(variable)
        for (let index: number = coefficients.length - 1; index >= 0; index--) {
            if (!coefficients[index].equals(0)) return index
        }
        return -Infinity
    }

    /**
     * The coefficient of the highest power of a variable in the expression, a polynomial in it. An expression that is
     * not a polynomial in the variable throws `MathNotSupportedException`.
     * @param variable The variable.
     */
    public leadingCoefficient(variable: string): Expression {
        const degree: number = this.degree(variable)
        return degree === -Infinity ? this.#expression(nativeCall((native) => native.number(0))) : this.coefficients(variable)[degree]
    }

    /**
     * The quotient and the remainder of the division by another polynomial in a variable: `x^3 + 2x + 1` divided by
     * `x^2 + a` is `x`, remainder `-a*x + 2x + 1`. The coefficients may hold other variables.
     * @param divisor The divisor: an expression, a number or a formula.
     * @param variable The variable of the polynomials.
     */
    public divide(divisor: Value, variable: string): { quotient: Expression, remainder: Expression } {
        const [quotient, remainder]: Handle[] = this.context.run<Handle[]>('divide', [this.handle, handleOf(this.context, divisor), variable])
        return {quotient: this.#expression(quotient), remainder: this.#expression(remainder)}
    }

    /**
     * `divide()` in the threads of the addon.
     * @param divisor The divisor: an expression, a number or a formula.
     * @param variable The variable of the polynomials.
     * @param options Its cancellation, its time limit.
     */
    public async divideAsync(divisor: Value, variable: string, options?: AsyncOptions): Promise<{ quotient: Expression, remainder: Expression }> {
        const [quotient, remainder]: Handle[] = await this.context.runAsync<Handle[]>('divide', [this.handle, handleOf(this.context, divisor), variable], options)
        return {quotient: this.#expression(quotient), remainder: this.#expression(remainder)}
    }

    /**
     * The expression written with another function: `cosh(x)` with `'exp'` is `e^(-x)/2 + e^x/2`, `sin(x)` with
     * `'cos'` is `cos(x - pi/2)`.
     * @param form `'exp'`, `'sin'` or `'cos'`.
     */
    public rewrite(form: 'exp' | 'sin' | 'cos'): Expression {
        return this.#expression(this.context.run<Handle>('rewrite', [this.handle, form]))
    }

    /**
     * Whether the expression is zero: `undefined` when it is not known (a value close to zero that is not shown to be
     * zero exactly). Like the other predicates, it is decided by the properties of the expression, or by its value
     * when it has no variables and the value is clearly away from the boundary.
     */
    public isZero(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'zero'])
    }

    /**
     * Whether the expression is a positive real number (`pi - 3` is), `undefined` when it is not known (`x`).
     */
    public isPositive(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'positive'])
    }

    /**
     * Whether the expression is a negative real number, `undefined` when it is not known.
     */
    public isNegative(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'negative'])
    }

    /**
     * Whether the expression is an integer (`2^10` is, `sqrt(2)` is not), `undefined` when it is not known.
     */
    public isInteger(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'integer'])
    }

    /**
     * Whether the expression is a rational number (`1/3` is, `e` is not), `undefined` when it is not known.
     */
    public isRational(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'rational'])
    }

    /**
     * Whether the expression is a real number (`i` is not), `undefined` when it is not known (`x`: the variables are
     * complex numbers).
     */
    public isReal(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'real'])
    }

    /**
     * Whether the expression is finite (`1/0` is not), `undefined` when it is not known.
     */
    public isFinite(): boolean | undefined {
        return this.context.run<boolean | undefined>('predicate', [this.handle, 'finite'])
    }

    /**
     * The order of the expression and another value, both real: -1 when it is smaller, 0 when they are equal, 1 when it
     * is larger, `undefined` when it is not known (variables, or values too close to tell). `pi` compared with `22/7`
     * is -1. Two constants are compared by their decimals of 60 digits where `toDecimal()` computes them (`pi` is
     * larger than `3.14159265358979323846`); too close for those, they are equal when `equals()` shows it and they are
     * not too large an expression. With variables, the order comes from their difference expanded, then from its sign
     * where it is known.
     * @param other The other value: an expression, a number or a formula.
     */
    public compare(other: Value): -1 | 0 | 1 | undefined {
        return this.context.run<-1 | 0 | 1 | undefined>('compare', [this.handle, handleOf(this.context, other)])
    }

    /**
     * The expression compiled into a function of numbers, for evaluating it many times (a plot, a numerical integral).
     * @param variables The variables, in the order of the values: the ones of the expression, sorted, by default.
     */
    public compile(variables?: string[]): CompiledFunction {
        const inputs: string[] = variables ?? this.variables()
        const compiled: Handle = nativeCall((native) => native.compile(this.handle, inputs))
        const call = (...values: number[]): number => nativeCall((native) => native.call(compiled, ...values))
        return Object.assign(call, {
            variables: Object.freeze([...inputs]),
            batch: (rows: Float64Array): Float64Array => nativeCall((native) => native.callBatch(compiled, rows))
        })
    }
}

/**
 * An equation: `left = right`.
 * @example
 * ```typescript
 * import {type Equation, math} from '@lakutata/math'
 *
 * function example(): void {
 *     const equation: Equation = math.equation('x^2 = 4')
 *     console.log(equation.solve('x').map(String)) //['-2', '2']
 * }
 * ```
 */
export class Equation {

    /**
     * An equation of two expressions.
     * @param left The left side.
     * @param right The right side.
     */
    constructor(public readonly left: Expression, public readonly right: Expression) {
    }

    /**
     * `left = right`.
     */
    public toString(): string {
        return `${this.left.toString()} = ${this.right.toString()}`
    }

    /**
     * The equation, for `JSON.stringify()`.
     */
    public toJSON(): string {
        return this.toString()
    }

    /**
     * The LaTeX of the equation.
     */
    public toTeX(): string {
        return `${this.left.toTeX()} = ${this.right.toTeX()}`
    }

    /**
     * `left - right`: the expression whose zeros are the solutions.
     */
    public difference(): Expression {
        return this.left.sub(this.right)
    }

    /**
     * The equation with variables replaced on both sides.
     * @param values The values, by the names of the variables.
     */
    public substitute(values: Record<string, Value>): Equation {
        return new Equation(this.left.substitute(values), this.right.substitute(values))
    }

    /**
     * The solutions of the equation for a variable.
     * @param variable The variable.
     * @param options The domain of the solutions.
     */
    public solve(variable: string, options: SolveOptions = {}): Solutions {
        return this.difference().solve(variable, options)
    }

    /**
     * `solve()` in the threads of the addon.
     * @param variable The variable.
     * @param options The domain of the solutions, the cancellation, the time limit.
     */
    public async solveAsync(variable: string, options: SolveOptions & AsyncOptions = {}): Promise<Solutions> {
        return await this.difference().solveAsync(variable, options)
    }
}

/**
 * The relation of an inequality
 */
export type InequalityRelation = '<' | '>' | '<=' | '>='

/**
 * An inequality: `left < right`, `left <= right`, `left > right`, `left >= right`.
 * @example
 * ```typescript
 * import {type Inequality, math} from '@lakutata/math'
 *
 * function example(): void {
 *     const inequality = math.parse('x^2 < 4') as Inequality
 *     console.log(inequality.relation, inequality.right.toString()) //< 4
 * }
 * ```
 */
export class Inequality {

    /**
     * An inequality of two expressions.
     * @param left The left side.
     * @param right The right side.
     * @param relation The relation.
     */
    constructor(public readonly left: Expression, public readonly right: Expression, public readonly relation: InequalityRelation) {
    }

    /**
     * The real solutions of the inequality for a variable, as intervals and values (`set`): `x^2 < 4` gives `(-2, 2)`,
     * `x^2*(x + 1) <= 0` gives `(-inf, -1] ∪ {0}`. Its sides are fractions of polynomials in the variable with rational
     * coefficients; the zeros of a denominator are never solutions. A root without an exact form (`x^5 - x - 1`),
     * another variable or another function throws `MathNotSupportedException`.
     * @param variable The variable.
     * @example
     * ```typescript
     * import {type Inequality, parse} from '@lakutata/math'
     *
     * console.log((parse('x^2 < 2') as Inequality).solve('x').toString())          //(-sqrt(2), sqrt(2))
     * console.log((parse('(x + 1)/(x - 2) >= 0') as Inequality).solve('x').set.toString()) //(-inf, -1] ∪ (2, inf)
     * ```
     */
    public solve(variable: string): Solutions {
        const context: Context = contextOf(this.left)
        return solutionsOf(context, context.run<NativeSolutions>('inequality', [this.left.sub(this.right).handle, this.relation, variable]))
    }

    /**
     * `solve()` in the threads of the addon.
     * @param variable The variable.
     * @param options The cancellation, the time limit.
     */
    public async solveAsync(variable: string, options?: AsyncOptions): Promise<Solutions> {
        const context: Context = contextOf(this.left)
        return solutionsOf(context, await context.runAsync<NativeSolutions>('inequality', [this.left.sub(this.right).handle, this.relation, variable], options))
    }

    /**
     * `left < right`…
     */
    public toString(): string {
        return `${this.left.toString()} ${this.relation} ${this.right.toString()}`
    }

    /**
     * The inequality, for `JSON.stringify()`.
     */
    public toJSON(): string {
        return this.toString()
    }

    /**
     * The LaTeX of the inequality.
     */
    public toTeX(): string {
        const relation: string = {'<': '<', '>': '>', '<=': '\\leq', '>=': '\\geq'}[this.relation]
        return `${this.left.toTeX()} ${relation} ${this.right.toTeX()}`
    }
}

/**
 * The kind of the solutions of an equation: some values, none, every value, intervals, or a set not solved
 */
export type SolutionsKind = 'finite' | 'empty' | 'all' | 'intervals' | 'unsolved' | 'other'

/**
 * The solutions of an equation or of an inequality: an array of their values (the real ones by value, then the
 * complex ones; the values apart from the intervals of an inequality), what they are (`kind`): some values
 * (`finite`), none (`empty`), every value (`all`), intervals, or a set the package does not solve (`unsolved`,
 * `other`: `text` describes it), and all of them as a set (`set`).
 * @example
 * ```typescript
 * import {math, type Solutions} from '@lakutata/math'
 *
 * function example(): void {
 *     const solutions: Solutions = math.expression('x^4 - 1').solve('x')
 *     console.log(solutions.kind, solutions.map(String)) //finite ['-1', '1', '-i', 'i']
 *     console.log(solutions.set.toString())               //{-1, 1, -i, i}
 * }
 * ```
 */
export class Solutions extends Array<Expression> {

    /**
     * The maps and the filters of the solutions are arrays.
     */
    static get [Symbol.species](): ArrayConstructor {
        return Array
    }

    /**
     * Solutions of a kind; their values pushed after.
     * @param kind What the solutions are.
     * @param set All of them as a set.
     * @param text The description of a set not solved.
     */
    constructor(public readonly kind: SolutionsKind, public readonly set: MathSet, public readonly text?: string) {
        super()
    }

    /**
     * The values, the intervals in their notation (`(-inf, -1] ∪ {0}`) or the description of the solutions.
     */
    public toString(): string {
        if (this.kind === 'all') return 'every value'
        if (this.kind === 'unsolved' || this.kind === 'other') return this.text ?? ''
        if (this.kind === 'intervals') return this.set.toString()
        return this.map(String).join(', ')
    }
}

/**
 * The expression equal to zero of an equation of a system: its difference, or the expression given
 * @param context The context of the definitions.
 * @param equation The equation: an equation, a formula, or an expression equal to zero.
 */
export function equationHandleOf(context: Context, equation: Equation | Expression | string): Handle {
    if (equation instanceof Equation) return equation.difference().handle
    if (typeof equation !== 'string') return handleOf(context, equation)
    const parsed: NativeParsed = parsedOf(context, equation)
    if (parsed.kind === 'relation' || parsed.kind === 'matrix') throw new MathSyntaxException(`An equation is expected, not ${parsed.kind === 'matrix' ? 'a matrix' : 'an inequality'}: ${equation}`)
    return parsed.kind === 'equation' ? new Equation(new Expression(context, parsed.left), new Expression(context, parsed.right!)).difference().handle : parsed.left
}
