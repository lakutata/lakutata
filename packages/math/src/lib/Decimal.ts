import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {nativeCall} from './Native.js'

/**
 * A value given where a decimal is expected: a decimal, a number (by its shortest representation: `0.1` is 0.1, not the
 * binary value of the double), a bigint, or a decimal number written as a string (`'19.99'`, `'-1.5e-7'`)
 */
export type DecimalValue = Decimal | number | bigint | string

/**
 * The options of `decimal()`
 */
export interface DecimalOptions {
    /**
     * The significant digits of the decimal and of the results of its operations, from 1 to 100000: the `precision`
     * of the component by default.
     */
    precision?: number
}

const DECIMAL_TEXT: RegExp = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/**
 * The text of a decimal value, all its digits: an argument of the operations of the addon
 * @param value
 */
export function decimalText(value: DecimalValue): string {
    if (value instanceof Decimal) return value.toString()
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new MathArgumentException(`${value} is not a decimal number`)
        return String(value)
    }
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'string' && DECIMAL_TEXT.test(value)) return value
    throw new MathArgumentException(`Not a decimal number: ${String(value)} (for a formula, pass math.expression(formula))`)
}

/**
 * An integer argument (the places of `round()`, the degree of `root()`) within limits
 * @param value
 * @param min
 * @param max
 * @param what
 */
function integerText(value: number, min: number, max: number, what: string): string {
    if (!Number.isInteger(value) || value < min || value > max) throw new MathArgumentException(`${what} is an integer from ${min} to ${max}`)
    return String(value)
}

/**
 * A decimal number of a precision: at most that many significant digits. The results of its operations are rounded to
 * its precision, correctly (the nearest decimal of that many digits, halves to even), and have its precision, whatever
 * the precision of the values given to them; those are read exactly. A decimal does not change: each operation gives a
 * new one. Decimals are made by `decimal()` of the component or of a scope.
 *
 * The operations run in the thread of JavaScript, as the arithmetic of numbers, without a time limit. The arithmetic
 * is quick at any precision; the functions (`sin()`, `atan()`…) take seconds at tens of thousands of digits, and the
 * special functions (`zeta()`, `gamma()`) at thousands. For those, compute the value of an expression with
 * `toDecimalAsync()` (a time limit, a cancellation), then make a decimal of it.
 *
 * A division by zero (`div(0)`, `mod(0)`, `ln()` of 0, 0 to a negative power) throws `MathDivisionByZeroException`; a
 * value outside the domain of a function (`sqrt()` of a negative number, `asin()` of 2, a negative number to a
 * non-integer power) throws `MathDomainException`. A result whose exponent is beyond the range of decimals (about
 * ±10^18, ±4.25 × 10^8 on 32-bit systems) throws `MathNotSupportedException`.
 * @example
 * ```typescript
 * import {Container} from 'lakutata'
 * import {Math} from '@lakutata/math'
 *
 * const container: Container = new Container()
 * await container.setNamed('math', Math, {})
 * const math: Math = await container.get<Math>('math')
 * math.decimal(0.1).add(0.2).toString()                       //0.3
 * math.decimal('19.99').mul(3).toFixed(2)                     //59.97
 * math.decimal(1, {precision: 5}).div(3).toString()           //0.33333
 * math.decimal(2, {precision: 40}).sqrt().toString()          //1.41421356237309504880168872420969807857
 * math.decimal(math.expression('pi'), {precision: 30}).toString()   //3.14159265358979323846264338328
 * await container.destroy()
 * ```
 */
export class Decimal {

    readonly #text: string

    /**
     * A decimal of a text that has at most `precision` significant digits. Made by `decimal()` and by the operations.
     * @param text The text of the decimal: its shortest digits.
     * @param precision The significant digits of the decimal and of the results of its operations.
     */
    constructor(text: string, public readonly precision: number) {
        this.#text = text
    }

    #operation(name: string, ...values: string[]): string {
        return nativeCall((native) => native.run('decimalOperation', [name, this.precision, this.#text, ...values])) as string
    }

    #decimal(name: string, ...values: string[]): Decimal {
        return new Decimal(this.#operation(name, ...values), this.precision)
    }

    /**
     * The sum of the decimal and a value.
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public add(other: DecimalValue): Decimal {
        return this.#decimal('add', decimalText(other))
    }

    /**
     * The difference of the decimal and a value.
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public sub(other: DecimalValue): Decimal {
        return this.#decimal('sub', decimalText(other))
    }

    /**
     * The product of the decimal and a value.
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public mul(other: DecimalValue): Decimal {
        return this.#decimal('mul', decimalText(other))
    }

    /**
     * The quotient of the decimal by a value.
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public div(other: DecimalValue): Decimal {
        return this.#decimal('div', decimalText(other))
    }

    /**
     * The remainder of the decimal divided by a value, of the sign of the value (`a - b*floor(a/b)`, as `mod()` of the
     * formulas): `mod(-7, 3)` is 2.
     * @param other The divisor: a decimal, a number, a bigint or a decimal number written as a string.
     */
    public mod(other: DecimalValue): Decimal {
        return this.#decimal('mod', decimalText(other))
    }

    /**
     * The decimal to a power. `0^0` is 1, as in the formulas.
     * @param exponent A decimal, a number, a bigint or a decimal number written as a string.
     */
    public pow(exponent: DecimalValue): Decimal {
        return this.#decimal('pow', decimalText(exponent))
    }

    /**
     * The opposite of the decimal.
     */
    public neg(): Decimal {
        return this.#decimal('neg')
    }

    /**
     * The absolute value of the decimal.
     */
    public abs(): Decimal {
        return this.#decimal('abs')
    }

    /**
     * The square root of the decimal.
     */
    public sqrt(): Decimal {
        return this.#decimal('sqrt')
    }

    /**
     * The real cube root of the decimal: negative for a negative decimal (`cbrt(-8)` is -2).
     */
    public cbrt(): Decimal {
        return this.#decimal('root', '3')
    }

    /**
     * The real root of a degree: the root of the absolute value, negative for a negative decimal and an odd degree (an
     * even degree of a negative decimal throws `MathDomainException`).
     * @param degree The degree, an integer from 1 to 1000000000.
     */
    public root(degree: number): Decimal {
        return this.#decimal('root', integerText(degree, 1, 1000000000, 'The degree of a root'))
    }

    /**
     * The exponential of the decimal: e to its power.
     */
    public exp(): Decimal {
        return this.#decimal('exp')
    }

    /**
     * The natural logarithm of the decimal.
     */
    public ln(): Decimal {
        return this.#decimal('ln')
    }

    /**
     * The logarithm of the decimal in base 10.
     */
    public log10(): Decimal {
        return this.#decimal('log10')
    }

    /**
     * The logarithm of the decimal in a base.
     * @param base The base, a positive value other than 1.
     */
    public log(base: DecimalValue): Decimal {
        return this.#decimal('log', decimalText(base))
    }

    /**
     * The sine of the decimal, in radians.
     */
    public sin(): Decimal {
        return this.#decimal('sin')
    }

    /**
     * The cosine of the decimal, in radians.
     */
    public cos(): Decimal {
        return this.#decimal('cos')
    }

    /**
     * The tangent of the decimal, in radians.
     */
    public tan(): Decimal {
        return this.#decimal('tan')
    }

    /**
     * The arcsine of the decimal (from -1 to 1), in radians.
     */
    public asin(): Decimal {
        return this.#decimal('asin')
    }

    /**
     * The arccosine of the decimal (from -1 to 1), in radians.
     */
    public acos(): Decimal {
        return this.#decimal('acos')
    }

    /**
     * The arctangent of the decimal, in radians.
     */
    public atan(): Decimal {
        return this.#decimal('atan')
    }

    /**
     * The angle of the point (x, y), the decimal being y, in radians from -pi to pi: `atan2(y, x)` of the formulas.
     * `atan2(0, 0)` throws `MathDomainException`.
     * @param x The abscissa: a decimal, a number, a bigint or a decimal number written as a string.
     */
    public atan2(x: DecimalValue): Decimal {
        return this.#decimal('atan2', decimalText(x))
    }

    /**
     * The hyperbolic sine of the decimal.
     */
    public sinh(): Decimal {
        return this.#decimal('sinh')
    }

    /**
     * The hyperbolic cosine of the decimal.
     */
    public cosh(): Decimal {
        return this.#decimal('cosh')
    }

    /**
     * The hyperbolic tangent of the decimal.
     */
    public tanh(): Decimal {
        return this.#decimal('tanh')
    }

    /**
     * The inverse hyperbolic sine of the decimal.
     */
    public asinh(): Decimal {
        return this.#decimal('asinh')
    }

    /**
     * The inverse hyperbolic cosine of the decimal (1 or more).
     */
    public acosh(): Decimal {
        return this.#decimal('acosh')
    }

    /**
     * The inverse hyperbolic tangent of the decimal (between -1 and 1).
     */
    public atanh(): Decimal {
        return this.#decimal('atanh')
    }

    /**
     * The gamma function of the decimal (`gamma(n)` is `(n - 1)!`). At 0 and the negative integers, its poles, it throws
     * `MathDivisionByZeroException`.
     */
    public gamma(): Decimal {
        return this.#decimal('gamma')
    }

    /**
     * The logarithm of the gamma function of the decimal, of a positive decimal (of a negative one it is not real).
     */
    public loggamma(): Decimal {
        return this.#decimal('loggamma')
    }

    /**
     * The digamma function of the decimal: the derivative of `loggamma`.
     */
    public digamma(): Decimal {
        return this.#decimal('digamma')
    }

    /**
     * The error function of the decimal.
     */
    public erf(): Decimal {
        return this.#decimal('erf')
    }

    /**
     * The complementary error function of the decimal, `1 - erf`, with all its digits where it is small (`erfc(10)` is
     * about 2.1e-45).
     */
    public erfc(): Decimal {
        return this.#decimal('erfc')
    }

    /**
     * The zeta function of Riemann of the decimal. At 1, its pole, it throws `MathDivisionByZeroException`.
     */
    public zeta(): Decimal {
        return this.#decimal('zeta')
    }

    /**
     * The principal branch of Lambert's W function of the decimal: the solution w of `w*e^w = x`, from -1/e on (below,
     * it is not real).
     */
    public lambertw(): Decimal {
        return this.#decimal('lambertw')
    }

    /**
     * The largest integer not above the decimal.
     */
    public floor(): Decimal {
        return this.#decimal('floor')
    }

    /**
     * The smallest integer not below the decimal.
     */
    public ceil(): Decimal {
        return this.#decimal('ceil')
    }

    /**
     * The integer part of the decimal (its digits after the point dropped).
     */
    public trunc(): Decimal {
        return this.#decimal('trunc')
    }

    /**
     * The decimal rounded to a number of places after the point, halves away from zero (as `round()` of the formulas):
     * `round(2)` of 2.345 is 2.35, `round(-2)` of 1250 is 1300.
     * @param places The places after the point (before it when negative), from -1000000000 to 1000000000: 0 by default.
     */
    public round(places: number = 0): Decimal {
        return this.#decimal('roundTo', integerText(places, -1000000000, 1000000000, 'The places'))
    }

    /**
     * Compare the decimal and a value: -1 when the decimal is smaller, 0 when they are equal, 1 when it is larger.
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public compare(other: DecimalValue): -1 | 0 | 1 {
        return Number(this.#operation('compare', decimalText(other))) as -1 | 0 | 1
    }

    /**
     * Whether the decimal is equal to a value (whatever their precisions: `1.50` and `1.5` are equal).
     * @param other A decimal, a number, a bigint or a decimal number written as a string.
     */
    public equals(other: DecimalValue): boolean {
        return this.compare(other) === 0
    }

    /**
     * Whether the decimal is 0.
     */
    public isZero(): boolean {
        return this.#text === '0'
    }

    /**
     * Whether the decimal is greater than 0.
     */
    public isPositive(): boolean {
        return !this.isZero() && !this.#text.startsWith('-')
    }

    /**
     * Whether the decimal is less than 0.
     */
    public isNegative(): boolean {
        return this.#text.startsWith('-')
    }

    /**
     * Whether the decimal is an integer.
     */
    public isInteger(): boolean {
        return this.#operation('isInteger') === 'true'
    }

    /**
     * The digits of the decimal, without trailing zeros: written as a fixed-point number when the exponent of its
     * first digit is from -6 to the precision minus 1 (`0.000025`, `1250`), in scientific notation otherwise
     * (`1.5e+25`, `1e-7`). Read back by `decimal()` and by the formulas, it gives the same value.
     */
    public toString(): string {
        return this.#text
    }

    /**
     * The decimal written with a number of places after the point, rounded halves away from zero, its trailing zeros
     * kept: `toFixed(2)` of 1.5 is `1.50`.
     * @param places The places after the point, from 0 to 100000: 0 by default.
     */
    public toFixed(places: number = 0): string {
        return this.#operation('fixed', integerText(places, 0, 100000, 'The places'))
    }

    /**
     * The nearest number (a double) to the decimal.
     */
    public toNumber(): number {
        return Number(this.#text)
    }

    /**
     * The text of the decimal, as `toString()`: decimals in JSON are strings, all their digits kept.
     */
    public toJSON(): string {
        return this.#text
    }
}
