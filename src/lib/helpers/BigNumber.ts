import Bignumber from 'bignumber.js'

export type BigNumberConstructor = typeof BigNumber
export type BigNumberValue = string | number | bigint | BigNumber
export type BigNumberModuloMode = 0 | 1 | 3 | 6 | 9
export type BigNumberRoundingMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface BigNumberConfig {
    /**
     * An integer, 0 to 1e+9. Default value: 20.
     *
     * The maximum number of decimal places of the result of operations involving division, i.e.
     * division, square root and base conversion operations, and exponentiation when the exponent is
     * negative.
     *
     * ```ts
     * BigNumber.config({ DECIMAL_PLACES: 5 })
     * BigNumber.set({ DECIMAL_PLACES: 5 })
     * ```
     */
    DECIMAL_PLACES?: number;

    /**
     * An integer, 0 to 8. Default value: `BigNumber.ROUND_HALF_UP` (4).
     *
     * The rounding mode used in operations that involve division (see `DECIMAL_PLACES`) and the
     * default rounding mode of the `decimalPlaces`, `precision`, `toExponential`, `toFixed`,
     * `toFormat` and `toPrecision` methods.
     *
     * The modes are available as enumerated properties of the BigNumber constructor.
     *
     * ```ts
     * BigNumber.config({ ROUNDING_MODE: 0 })
     * BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_UP })
     * ```
     */
    ROUNDING_MODE?: BigNumberRoundingMode

    /**
     * An integer, 0 to 1e+9, or an array, [-1e+9 to 0, 0 to 1e+9].
     * Default value: `[-7, 20]`.
     *
     * The exponent value(s) at which `toString` returns exponential notation.
     *
     * If a single number is assigned, the value is the exponent magnitude.
     *
     * If an array of two numbers is assigned then the first number is the negative exponent value at
     * and beneath which exponential notation is used, and the second number is the positive exponent
     * value at and above which exponential notation is used.
     *
     * For example, to emulate JavaScript numbers in terms of the exponent values at which they begin
     * to use exponential notation, use `[-7, 20]`.
     *
     * ```ts
     * BigNumber.config({ EXPONENTIAL_AT: 2 })
     * new BigNumber(12.3)         // '12.3'        e is only 1
     * new BigNumber(123)          // '1.23e+2'
     * new BigNumber(0.123)        // '0.123'       e is only -1
     * new BigNumber(0.0123)       // '1.23e-2'
     *
     * BigNumber.config({ EXPONENTIAL_AT: [-7, 20] })
     * new BigNumber(123456789)    // '123456789'   e is only 8
     * new BigNumber(0.000000123)  // '1.23e-7'
     *
     * // Almost never return exponential notation:
     * BigNumber.config({ EXPONENTIAL_AT: 1e+9 })
     *
     * // Always return exponential notation:
     * BigNumber.config({ EXPONENTIAL_AT: 0 })
     * ```
     *
     * Regardless of the value of `EXPONENTIAL_AT`, the `toFixed` method will always return a value in
     * normal notation and the `toExponential` method will always return a value in exponential form.
     * Calling `toString` with a base argument, e.g. `toString(10)`, will also always return normal
     * notation.
     */
    EXPONENTIAL_AT?: number | [number, number]

    /**
     * An integer, magnitude 1 to 1e+9, or an array, [-1e+9 to -1, 1 to 1e+9].
     * Default value: `[-1e+9, 1e+9]`.
     *
     * The exponent value(s) beyond which overflow to Infinity and underflow to zero occurs.
     *
     * If a single number is assigned, it is the maximum exponent magnitude: values wth a positive
     * exponent of greater magnitude become Infinity and those with a negative exponent of greater
     * magnitude become zero.
     *
     * If an array of two numbers is assigned then the first number is the negative exponent limit and
     * the second number is the positive exponent limit.
     *
     * For example, to emulate JavaScript numbers in terms of the exponent values at which they
     * become zero and Infinity, use [-324, 308].
     *
     * ```ts
     * BigNumber.config({ RANGE: 500 })
     * BigNumber.config().RANGE     // [ -500, 500 ]
     * new BigNumber('9.999e499')   // '9.999e+499'
     * new BigNumber('1e500')       // 'Infinity'
     * new BigNumber('1e-499')      // '1e-499'
     * new BigNumber('1e-500')      // '0'
     *
     * BigNumber.config({ RANGE: [-3, 4] })
     * new BigNumber(99999)         // '99999'      e is only 4
     * new BigNumber(100000)        // 'Infinity'   e is 5
     * new BigNumber(0.001)         // '0.01'       e is only -3
     * new BigNumber(0.0001)        // '0'          e is -4
     * ```
     * The largest possible magnitude of a finite BigNumber is 9.999...e+1000000000.
     * The smallest possible magnitude of a non-zero BigNumber is 1e-1000000000.
     */
    RANGE?: number | [number, number]

    /**
     * A boolean: `true` or `false`. Default value: `false`.
     *
     * The value that determines whether cryptographically-secure pseudo-random number generation is
     * used. If `CRYPTO` is set to true then the random method will generate random digits using
     * `crypto.getRandomValues` in browsers that support it, or `crypto.randomBytes` if using a
     * version of Node.js that supports it.
     *
     * If neither function is supported by the host environment then attempting to set `CRYPTO` to
     * `true` will fail and an exception will be thrown.
     *
     * If `CRYPTO` is `false` then the source of randomness used will be `Math.random` (which is
     * assumed to generate at least 30 bits of randomness).
     *
     * See `BigNumber.random`.
     *
     * ```ts
     * // Node.js
     * global.crypto = require('crypto')
     *
     * BigNumber.config({ CRYPTO: true })
     * BigNumber.config().CRYPTO       // true
     * BigNumber.random()              // 0.54340758610486147524
     * ```
     */
    CRYPTO?: boolean

    /**
     * An integer, 0, 1, 3, 6 or 9. Default value: `BigNumber.ROUND_DOWN` (1).
     *
     * The modulo mode used when calculating the modulus: `a mod n`.
     * The quotient, `q = a / n`, is calculated according to the `ROUNDING_MODE` that corresponds to
     * the chosen `MODULO_MODE`.
     * The remainder, `r`, is calculated as: `r = a - n * q`.
     *
     * The modes that are most commonly used for the modulus/remainder operation are shown in the
     * following table. Although the other rounding modes can be used, they may not give useful
     * results.
     *
     * Property           | Value | Description
     * :------------------|:------|:------------------------------------------------------------------
     *  `ROUND_UP`        |   0   | The remainder is positive if the dividend is negative.
     *  `ROUND_DOWN`      |   1   | The remainder has the same sign as the dividend.
     *                    |       | Uses 'truncating division' and matches JavaScript's `%` operator .
     *  `ROUND_FLOOR`     |   3   | The remainder has the same sign as the divisor.
     *                    |       | This matches Python's `%` operator.
     *  `ROUND_HALF_EVEN` |   6   | The IEEE 754 remainder function.
     *  `EUCLID`          |   9   | The remainder is always positive.
     *                    |       | Euclidian division: `q = sign(n) * floor(a / abs(n))`
     *
     * The rounding/modulo modes are available as enumerated properties of the BigNumber constructor.
     *
     * See `modulo`.
     *
     * ```ts
     * BigNumber.config({ MODULO_MODE: BigNumber.EUCLID })
     * BigNumber.set({ MODULO_MODE: 9 })          // equivalent
     * ```
     */
    MODULO_MODE?: BigNumberModuloMode

    /**
     * An integer, 0 to 1e+9. Default value: 0.
     *
     * The maximum precision, i.e. number of significant digits, of the result of the power operation
     * - unless a modulus is specified.
     *
     * If set to 0, the number of significant digits will not be limited.
     *
     * See `exponentiatedBy`.
     *
     * ```ts
     * BigNumber.config({ POW_PRECISION: 100 })
     * ```
     */
    POW_PRECISION?: number

    /**
     * An object including any number of the properties shown below.
     *
     * The object configures the format of the string returned by the `toFormat` method.
     * The example below shows the properties of the object that are recognised, and
     * their default values.
     *
     * Unlike the other configuration properties, the values of the properties of the `FORMAT` object
     * will not be checked for validity - the existing object will simply be replaced by the object
     * that is passed in.
     *
     * See `toFormat`.
     *
     * ```ts
     * BigNumber.config({
     *   FORMAT: {
     *     // string to prepend
     *     prefix: '',
     *     // the decimal separator
     *     decimalSeparator: '.',
     *     // the grouping separator of the integer part
     *     groupSeparator: ',',
     *     // the primary grouping size of the integer part
     *     groupSize: 3,
     *     // the secondary grouping size of the integer part
     *     secondaryGroupSize: 0,
     *     // the grouping separator of the fraction part
     *     fractionGroupSeparator: ' ',
     *     // the grouping size of the fraction part
     *     fractionGroupSize: 0,
     *     // string to append
     *     suffix: ''
     *   }
     * })
     * ```
     */
    FORMAT?: BigNumberFormat

    /**
     * The alphabet used for base conversion. The length of the alphabet corresponds to the maximum
     * value of the base argument that can be passed to the BigNumber constructor or `toString`.
     *
     * Default value: `'0123456789abcdefghijklmnopqrstuvwxyz'`.
     *
     * There is no maximum length for the alphabet, but it must be at least 2 characters long,
     * and it must not contain whitespace or a repeated character, or the sign indicators '+' and
     * '-', or the decimal separator '.'.
     *
     * ```ts
     * // duodecimal (base 12)
     * BigNumber.config({ ALPHABET: '0123456789TE' })
     * x = new BigNumber('T', 12)
     * x.toString()                // '10'
     * x.toString(12)              // 'T'
     * ```
     */
    ALPHABET?: string;
}

export interface BigNumberFormat {
    /** The string to prepend. */
    prefix?: string;

    /** The decimal separator. */
    decimalSeparator?: string;

    /** The grouping separator of the integer part. */
    groupSeparator?: string;

    /** The primary grouping size of the integer part. */
    groupSize?: number;

    /** The secondary grouping size of the integer part. */
    secondaryGroupSize?: number;

    /** The grouping separator of the fraction part. */
    fractionGroupSeparator?: string;

    /** The grouping size of the fraction part. */
    fractionGroupSize?: number;

    /** The string to append. */
    suffix?: string;
}

function BigNumber(n: BigNumberValue, base?: number): BigNumber {
    return Bignumber(n, base)
}

BigNumber.min = function (...n: BigNumberValue[]): BigNumber {
    return Bignumber.min(...n)
}

BigNumber.max = function (...n: BigNumberValue[]): BigNumber {
    return Bignumber.max(...n)
}

BigNumber.set = function (object?: BigNumberConfig): BigNumberConfig {
    return Bignumber.set(object)
}

BigNumber.sum = function (...n: BigNumberValue[]): BigNumber {
    return Bignumber.sum(...n)
}


// BigNumber.clone = function (object?: BigNumberConfig): BigNumberConstructor {
//     return Bignumber.clone(object)
// }

BigNumber.config = function (object?: BigNumberConfig): BigNumberConfig {
    return Bignumber.config(object)
}


BigNumber.isBigNumber = function (value: any): boolean {
    return Bignumber.isBigNumber(value)
}

BigNumber.random = function (decimalPlaces?: number): BigNumber {
    return Bignumber.random(decimalPlaces)
}

BigNumber.EUCLID = Bignumber.EUCLID
BigNumber.DEBUG = Bignumber.DEBUG
BigNumber.ROUND_CEIL = Bignumber.ROUND_CEIL
BigNumber.ROUND_DOWN = Bignumber.ROUND_DOWN
BigNumber.ROUND_FLOOR = Bignumber.ROUND_FLOOR
BigNumber.ROUND_HALF_CEIL = Bignumber.ROUND_HALF_CEIL
BigNumber.ROUND_HALF_DOWN = Bignumber.ROUND_HALF_DOWN
BigNumber.ROUND_HALF_EVEN = Bignumber.ROUND_HALF_EVEN
BigNumber.ROUND_HALF_FLOOR = Bignumber.ROUND_HALF_FLOOR
BigNumber.ROUND_HALF_UP = Bignumber.ROUND_HALF_UP
BigNumber.ROUND_UP = Bignumber.ROUND_UP

BigNumber.prototype.abs = function (): BigNumber {
    return this.abs()
}

// Bignumber(1).abs()
// Bignumber(1).div()
// Bignumber(1).gte()
// Bignumber(1).gt()
// Bignumber(1).lte()
// Bignumber(1).lt()
// Bignumber(1).absoluteValue()
// Bignumber(1).c

export {BigNumber}