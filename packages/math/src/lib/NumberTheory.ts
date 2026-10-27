import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathDivisionByZeroException} from '../exceptions/MathDivisionByZeroException.js'
import {MathDomainException} from '../exceptions/MathDomainException.js'
import {type AsyncOptions, type Context} from './Context.js'
import {Expression, expressionOf, handleOf, type Value} from './Expression.js'
import {type Handle} from './Native.js'

/**
 * An integer: a bigint, or a number that is a safe integer (`Number.isSafeInteger()`); any other value throws
 * `MathArgumentException`.
 */
export type IntegerValue = bigint | number

/**
 * A prime factor and its exponent.
 */
export interface PrimeFactor {
    /**
     * The prime (-1 for the sign of a negative number).
     */
    prime: bigint
    /**
     * Its exponent.
     */
    exponent: number
}

/**
 * The greatest common divisor of two integers and the coefficients of Bézout's identity: `a*x + b*y = gcd`.
 */
export interface ExtendedGcd {
    /**
     * The greatest common divisor, 0 or positive.
     */
    gcd: bigint
    /**
     * The coefficient of `a`.
     */
    x: bigint
    /**
     * The coefficient of `b`.
     */
    y: bigint
}

/**
 * The solutions of a system of congruences: the integers equal to `remainder` modulo `modulus`.
 */
export interface Congruence {
    /**
     * The smallest solution that is 0 or positive.
     */
    remainder: bigint
    /**
     * The modulus of the solutions: the least common multiple of the moduli.
     */
    modulus: bigint
}

/**
 * The options of a continued fraction
 */
export interface ContinuedFractionOptions {
    /**
     * The largest number of terms, from 1 to 10000: 20 by default. A rational number has all its terms, up to it.
     */
    terms?: number
}

//A rational number: a numerator, a positive denominator
type Fraction = [bigint, bigint]

function floorOf([n, d]: Fraction): bigint {
    return n >= 0n ? n / d : -((-n + d - 1n) / d)
}

//The exact value of a decimal written by toDecimal() (3.14, -2.5e-7, 1e+25)
function fractionOf(text: string): Fraction {
    const [mantissa, exponentText] = text.split('e')
    const negative: boolean = mantissa.startsWith('-')
    const [whole, decimals = ''] = (negative ? mantissa.slice(1) : mantissa).split('.')
    const exponent: number = Number(exponentText ?? 0) - decimals.length
    let numerator: bigint = BigInt(whole + decimals) * (negative ? -1n : 1n)
    let denominator: bigint = 1n
    if (exponent >= 0) numerator *= 10n ** BigInt(exponent)
    else denominator = 10n ** BigInt(-exponent)
    return [numerator, denominator]
}

//The power of 10 of the last digit of a decimal of a number of significant digits
function lastDigitOf(text: string, digits: number): number {
    const [signed, exponentText] = text.split('e')
    const [whole, decimals = ''] = signed.replace(/^-/, '').split('.')
    const significant: string = (whole + decimals).replace(/^0+/, '')
    //The power of 10 of the first significant digit
    const first: number = Number(exponentText ?? 0) + whole.length - 1 - ((whole + decimals).length - significant.length)
    return first - digits + 1
}

/**
 * The number theory of the integers: divisibility, modular arithmetic, primes, factorization, integer sequences,
 * combinatorial numbers and continued fractions. It is `MathScope.ntheory`; the package exports the one of `math` as
 * `ntheory`. The integers are bigints, or numbers that are safe integers; the integer results are bigints, of any size
 * up to 2^20 bits (about 315000 digits).
 *
 * When a result does not exist (`modInverse()` of a number with no inverse, `primitiveRoot()` of a number with none,
 * `crt()` of congruences with no common solution), it is `undefined`. An argument outside the domain of a function
 * (`totient(0)`, `legendre(a, 9)`, `factorial(-1)`) throws `MathDomainException`, a modulus of 0
 * `MathDivisionByZeroException`. The results modulo `m` have the sign of `m`, as `mod()`.
 *
 * Testing primality is deterministic below 2^64. Above, it is the Baillie-PSW test, which no known composite number
 * passes. Factorization uses trial division, then Pollard's p - 1 and rho methods: quick up to about 20 digits, or when
 * all the prime factors but one are small. A number with two large prime factors (two primes of 25 digits) can take
 * days: factor it with `factorAsync()` and a time limit.
 * @example
 * ```typescript
 * import {math} from '@lakutata/math'
 *
 * math.ntheory.factor(360)                  //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
 * math.ntheory.isPrime(2n ** 127n - 1n)     //true
 * math.ntheory.powMod(4, 13, 497)           //445n
 * math.ntheory.crt([2, 3, 2], [3, 5, 7])    //{remainder: 23n, modulus: 105n}
 * math.ntheory.bernoulli(12).toString()     //'-691/2730'
 * ```
 */
export class NumberTheory {

    constructor(protected readonly context: Context) {
    }

    #run<T>(operation: string, args: unknown[]): T {
        return this.context.run<T>('ntheory', [operation, ...args])
    }

    async #runAsync<T>(operation: string, args: unknown[], options?: AsyncOptions): Promise<T> {
        return await this.context.runAsync<T>('ntheory', [operation, ...args], options)
    }

    /**
     * The greatest common divisor of integers, 0 or positive: `gcd(12, -18, 30)` is 6n, `gcd()` is 0n.
     * @param values The integers.
     */
    public gcd(...values: IntegerValue[]): bigint {
        return this.#run<bigint>('gcd', [values])
    }

    /**
     * The least common multiple of integers, 0 or positive: `lcm(4, 6, -10)` is 60n, `lcm()` is 1n.
     * @param values The integers.
     */
    public lcm(...values: IntegerValue[]): bigint {
        return this.#run<bigint>('lcm', [values])
    }

    /**
     * The greatest common divisor of two integers and the coefficients `x`, `y` of `a*x + b*y = gcd`, the ones of the
     * extended Euclidean algorithm (as SymPy's `igcdex`): `extendedGcd(240, 46)` is `{gcd: 2n, x: -9n, y: 47n}`.
     * @param a The first integer.
     * @param b The second integer.
     */
    public extendedGcd(a: IntegerValue, b: IntegerValue): ExtendedGcd {
        const [gcd, x, y]: bigint[] = this.#run<bigint[]>('extendedGcd', [a, b])
        return {gcd: gcd, x: x, y: y}
    }

    /**
     * The remainder of `a` divided by `m`, of the sign of `m`: `mod(-7, 3)` is 2n, `mod(7, -3)` is -2n (JavaScript's
     * `%` keeps the sign of `a`).
     * @param a The dividend.
     * @param m The modulus, not 0.
     */
    public mod(a: IntegerValue, m: IntegerValue): bigint {
        return this.#run<bigint>('mod', [a, m])
    }

    /**
     * The inverse of `a` modulo `m`: the `x` of `a*x = 1` modulo `m`, `undefined` when `a` and `m` have a common
     * factor. `modInverse(3, 7)` is 5n.
     * @param a The integer.
     * @param m The modulus, not 0.
     */
    public modInverse(a: IntegerValue, m: IntegerValue): bigint | undefined {
        return this.#run<bigint | undefined>('modInverse', [a, m])
    }

    /**
     * `base^exponent` modulo `m`, without computing the power: `powMod(4, 13, 497)` is 445n. A negative exponent is
     * a power of the inverse of `base`; when it has none, `MathDomainException` is thrown.
     * @param base The base.
     * @param exponent The exponent.
     * @param m The modulus, not 0.
     */
    public powMod(base: IntegerValue, exponent: IntegerValue, m: IntegerValue): bigint {
        return this.#run<bigint>('powMod', [base, exponent, m])
    }

    /**
     * Whether an integer is a prime: deterministic below 2^64, by the Baillie-PSW test above.
     * @param n The integer.
     */
    public isPrime(n: IntegerValue): boolean {
        return this.#run<boolean>('isPrime', [n])
    }

    /**
     * `isPrime()` in the threads of the addon, for integers of thousands of digits.
     * @param n The integer.
     * @param options Its cancellation, its time limit.
     */
    public async isPrimeAsync(n: IntegerValue, options?: AsyncOptions): Promise<boolean> {
        return await this.#runAsync<boolean>('isPrime', [n], options)
    }

    /**
     * The smallest prime larger than `n`: `nextPrime(1000000)` is 1000003n.
     * @param n The integer.
     */
    public nextPrime(n: IntegerValue): bigint {
        return this.#run<bigint>('nextPrime', [n])
    }

    /**
     * `nextPrime()` in the threads of the addon.
     * @param n The integer.
     * @param options Its cancellation, its time limit.
     */
    public async nextPrimeAsync(n: IntegerValue, options?: AsyncOptions): Promise<bigint> {
        return await this.#runAsync<bigint>('nextPrime', [n], options)
    }

    /**
     * The prime factors of an integer and their exponents, from the smallest prime: -1 first for a negative integer
     * (`factor(-12)` is -1, 2^2, 3), none for 1, `-1` alone for -1; 0 throws `MathDomainException`. A number with two large prime
     * factors can take very long: use `factorAsync()` with a time limit.
     * @param n The integer.
     */
    public factor(n: IntegerValue): PrimeFactor[] {
        return this.#run<PrimeFactor[]>('factor', [n])
    }

    /**
     * `factor()` in the threads of the addon: stopped by the time limit or the cancellation.
     * @param n The integer.
     * @param options Its cancellation, its time limit.
     */
    public async factorAsync(n: IntegerValue, options?: AsyncOptions): Promise<PrimeFactor[]> {
        return await this.#runAsync<PrimeFactor[]>('factor', [n], options)
    }

    /**
     * Euler's totient: the count of the integers from 1 to `n` coprime with `n`, for `n >= 1` (it factors `n`).
     * @param n The integer.
     */
    public totient(n: IntegerValue): bigint {
        return this.#run<bigint>('totient', [n])
    }

    /**
     * `totient()` in the threads of the addon.
     * @param n The integer.
     * @param options Its cancellation, its time limit.
     */
    public async totientAsync(n: IntegerValue, options?: AsyncOptions): Promise<bigint> {
        return await this.#runAsync<bigint>('totient', [n], options)
    }

    /**
     * The Möbius function, for `n >= 1`: 0 when a square divides `n`, else 1 or -1 for an even or odd count of prime
     * factors (it factors `n`).
     * @param n The integer.
     */
    public mobius(n: IntegerValue): -1 | 0 | 1 {
        return this.#run<-1 | 0 | 1>('mobius', [n])
    }

    /**
     * `mobius()` in the threads of the addon.
     * @param n The integer.
     * @param options Its cancellation, its time limit.
     */
    public async mobiusAsync(n: IntegerValue, options?: AsyncOptions): Promise<-1 | 0 | 1> {
        return await this.#runAsync<-1 | 0 | 1>('mobius', [n], options)
    }

    /**
     * The smallest primitive root modulo `n`, for `n >= 2`: a number whose powers give every integer coprime with `n`.
     * `undefined` when there is none (only 2, 4, the powers of an odd prime and their doubles have one).
     * `primitiveRoot(23)` is 5n.
     * @param n The modulus.
     */
    public primitiveRoot(n: IntegerValue): bigint | undefined {
        return this.#run<bigint | undefined>('primitiveRoot', [n])
    }

    /**
     * `primitiveRoot()` in the threads of the addon.
     * @param n The modulus.
     * @param options Its cancellation, its time limit.
     */
    public async primitiveRootAsync(n: IntegerValue, options?: AsyncOptions): Promise<bigint | undefined> {
        return await this.#runAsync<bigint | undefined>('primitiveRoot', [n], options)
    }

    /**
     * The Legendre symbol `(a/p)`, for an odd prime `p`: 0 when `p` divides `a`, 1 when `a` is a square modulo `p`,
     * -1 otherwise.
     * @param a The integer.
     * @param p The odd prime.
     */
    public legendre(a: IntegerValue, p: IntegerValue): -1 | 0 | 1 {
        return this.#run<-1 | 0 | 1>('legendre', [a, p])
    }

    /**
     * The Jacobi symbol `(a/n)`, for an odd positive `n`: the product of the Legendre symbols of `a` and the prime
     * factors of `n`.
     * @param a The integer.
     * @param n The odd positive integer.
     */
    public jacobi(a: IntegerValue, n: IntegerValue): -1 | 0 | 1 {
        return this.#run<-1 | 0 | 1>('jacobi', [a, n])
    }

    /**
     * The common solutions of the congruences `x = remainders[i]` modulo `moduli[i]` (the Chinese remainder theorem):
     * the moduli need not be coprime. `undefined` when there is none. `crt([2, 3, 2], [3, 5, 7])` is
     * `{remainder: 23n, modulus: 105n}`.
     * @param remainders The remainders.
     * @param moduli The moduli, as many as the remainders, none of them 0.
     */
    public crt(remainders: IntegerValue[], moduli: IntegerValue[]): Congruence | undefined {
        const result: bigint[] | undefined = this.#run<bigint[] | undefined>('crt', [remainders, moduli])
        return result ? {remainder: result[0], modulus: result[1]} : undefined
    }

    /**
     * The Fibonacci number `F(n)`: F(0) = 0, F(1) = 1, F(n) = F(n - 1) + F(n - 2); for a negative `n`,
     * F(-n) = (-1)^(n + 1) F(n).
     * @param n The index.
     */
    public fibonacci(n: IntegerValue): bigint {
        return this.#run<bigint>('fibonacci', [n])
    }

    /**
     * The Lucas number `L(n)`: L(0) = 2, L(1) = 1, L(n) = L(n - 1) + L(n - 2); for a negative `n`,
     * L(-n) = (-1)^n L(n).
     * @param n The index.
     */
    public lucas(n: IntegerValue): bigint {
        return this.#run<bigint>('lucas', [n])
    }

    /**
     * The binomial coefficient `C(n, k)`: 0 for a negative `k`, or `k > n >= 0`; for a negative `n`,
     * `(-1)^k C(k - n - 1, k)` (as SymPy). `n` may be large: `binomial(10n ** 100n, 2)` is computed.
     * @param n The integer.
     * @param k The count.
     */
    public binomial(n: IntegerValue, k: IntegerValue): bigint {
        return this.#run<bigint>('binomial', [n, k])
    }

    /**
     * The number of arrangements of k of n items, `n! / (n - k)!`; without `k`, of all of them, `n!`. 0 for `k > n`
     * (mathjs throws).
     * @param n The number of items, 0 or more.
     * @param k The number arranged, 0 or more: `n` by default.
     */
    public permutations(n: IntegerValue, k?: IntegerValue): bigint {
        return this.#run<bigint>('permutations', k === undefined ? [n] : [n, k])
    }

    /**
     * The number of combinations with repetition of k items of n kinds (the multisets of k items of n kinds),
     * `C(n + k - 1, k)`: 1 for `n = k = 0`.
     * @param n The number of kinds, 0 or more.
     * @param k The number chosen, 0 or more.
     */
    public combinationsWithRepetition(n: IntegerValue, k: IntegerValue): bigint {
        return this.#run<bigint>('combinationsWithRepetition', [n, k])
    }

    /**
     * The multinomial coefficient `(k1 + k2 + …)! / (k1! k2! …)`: the ways to split items into groups of these sizes
     * (a count may be 0; of no counts, 1).
     * @param counts The sizes of the groups, 0 or more.
     */
    public multinomial(counts: IntegerValue[]): bigint {
        return this.#run<bigint>('multinomial', [counts])
    }

    /**
     * The Bell number `B(n)`: the number of partitions of a set of n items, for `n` from 0 to 2000.
     * @param n The number of items.
     */
    public bell(n: IntegerValue): bigint {
        return this.#run<bigint>('bell', [n])
    }

    /**
     * The Catalan number `C(2n, n) / (n + 1)`, for `n >= 0`.
     * @param n The index.
     */
    public catalan(n: IntegerValue): bigint {
        return this.#run<bigint>('catalan', [n])
    }

    /**
     * The Stirling number of the second kind `S(n, k)`: the number of partitions of a set of n items into k nonempty
     * blocks (0 for `k > n`; mathjs's `stirlingS2`), for `n` up to 50000 and `n k` up to 6250000.
     * @param n The number of items, 0 or more.
     * @param k The number of blocks, 0 or more.
     */
    public stirlingSecondKind(n: IntegerValue, k: IntegerValue): bigint {
        return this.#run<bigint>('stirlingSecondKind', [n, k])
    }

    /**
     * The number of compositions of n into k parts: the ways to write n as an ordered sum of k positive integers,
     * `C(n - 1, k - 1)` (mathjs's `composition`); 1 for `n = k = 0`, 0 for `k > n`.
     * @param n The integer, 0 or more.
     * @param k The number of parts, 0 or more.
     */
    public compositions(n: IntegerValue, k: IntegerValue): bigint {
        return this.#run<bigint>('compositions', [n, k])
    }

    /**
     * The factorial `n!`, for `n >= 0`, up to about 71000 (a result of 2^20 bits). A formula's `factorial(n)` (or
     * `n!`) stays `gamma(n + 1)` above 20000, so that an expression holding it stays printable; this one is computed.
     * @param n The integer.
     */
    public factorial(n: IntegerValue): bigint {
        return this.#run<bigint>('factorial', [n])
    }

    /**
     * The double factorial `n!! = n (n - 2) (n - 4)…`, down to 1 or 2, for `n >= -1` (`0!!` and `(-1)!!` are 1).
     * @param n The integer.
     */
    public doubleFactorial(n: IntegerValue): bigint {
        return this.#run<bigint>('doubleFactorial', [n])
    }

    /**
     * The Bernoulli number `B(n)`, an exact fraction, for `n` from 0 to 2000. `B(1)` is +1/2, as SymPy (some books,
     * and mathjs, give -1/2).
     * @param n The index.
     */
    public bernoulli(n: IntegerValue): Expression {
        return new Expression(this.context, this.#run<Handle>('bernoulli', [n]))
    }

    /**
     * The harmonic number `H(n) = 1 + 1/2 + … + 1/n`, an exact fraction, for `n` from 0 to 50000.
     * @param n The index.
     */
    public harmonic(n: IntegerValue): Expression {
        return new Expression(this.context, this.#run<Handle>('harmonic', [n]))
    }

    //The value of a continued fraction, an exact number or an expression without variables, and its largest number of
    //terms
    #continued(value: Value, options?: ContinuedFractionOptions): [Expression, number] {
        const terms: number = options?.terms ?? 20
        if (!Number.isInteger(terms) || terms < 1 || terms > 10000) throw new MathArgumentException('The number of terms is an integer from 1 to 10000')
        let expression: Expression = new Expression(this.context, handleOf(this.context, value))
        const variables: string[] = expression.variables()
        if (variables.length) throw new MathArgumentException(`A continued fraction is of a number, not of the variables ${variables.join(', ')}`)
        if (expression.isRational() !== true) {
            const expanded: Expression = expression.expand()
            if (expanded.isRational() === true) expression = expanded
        }
        if (expression.isReal() === false) throw new MathDomainException(`A continued fraction is of a real number, not of ${expression.toString()}`)
        return [expression, terms]
    }

    //The terms of a rational number, by Euclid's algorithm
    static #rationalTerms(expression: Expression, terms: number): bigint[] {
        let n: bigint = BigInt(expression.numerator().toString()), d: bigint = BigInt(expression.denominator().toString())
        if (d < 0n) [n, d] = [-n, -d]
        const result: bigint[] = []
        while (d !== 0n && result.length < terms) {
            const a: bigint = floorOf([n, d])
            result.push(a)
            ;[n, d] = [d, n - a * d]
        }
        return result
    }

    //The terms certain from a decimal of the value: x within its last digit of it, the interval of x mapped by each term,
    //until a term is not certain or the remainder may be 0. With all the digits there will be, a value that cannot be told
    //from an integer, or a remainder from 0, ends the continued fraction.
    static #decimalTerms(text: string, digits: number, terms: number, last: boolean): bigint[] | undefined {
        const center: Fraction = fractionOf(text)
        if (center[0] === 0n) return [0n]
        const power: number = lastDigitOf(text, digits)
        const ulp: Fraction = power >= 0 ? [10n ** BigInt(power), 1n] : [1n, 10n ** BigInt(-power)]
        //lo, hi: the center less and plus its last digit, on a common denominator
        const common: bigint = center[1] * ulp[1]
        let lo: Fraction = [center[0] * ulp[1] - ulp[0] * center[1], common], hi: Fraction = [center[0] * ulp[1] + ulp[0] * center[1], common]
        const result: bigint[] = []
        while (result.length < terms) {
            const a: bigint = floorOf(lo), b: bigint = floorOf(hi)
            if (a !== b) {
                if (!last) return undefined
                //Not told from the integer b
                result.push(b)
                return result
            }
            result.push(a)
            const loRest: Fraction = [lo[0] - a * lo[1], lo[1]], hiRest: Fraction = [hi[0] - a * hi[1], hi[1]]
            if (loRest[0] <= 0n) return last ? result : undefined
            lo = [hiRest[1], hiRest[0]]
            hi = [loRest[1], loRest[0]]
        }
        return result
    }

    static #startDigits(terms: number): number {
        return globalThis.Math.max(40, 2 * terms + 20)
    }

    static #lastDigits(terms: number): number {
        return globalThis.Math.min(100000, globalThis.Math.max(2000, 4 * terms))
    }

    /**
     * The continued fraction of a real number, `a0 + 1/(a1 + 1/(a2 + …))`: its terms, `a0` an integer, the others
     * positive. Of a rational number (a number of JavaScript is the decimal it prints as: `0.1` is 1/10), all its
     * terms, by Euclid's algorithm, the last one above 1 (as SymPy); of another value (`sqrt(2)`, `pi`), its first
     * terms, as many as `terms` asks (20 by default), each one certain: computed from decimals of the value, with more
     * digits until they settle each term. A remainder that cannot be told from 0, or a value that cannot be told from
     * an integer, even with thousands of digits, ends the continued fraction there.
     * @param value The number: a number, a bigint, a decimal, an expression without variables or a formula.
     * @param options The largest number of terms.
     * @example
     * ```typescript
     * import {ntheory} from '@lakutata/math'
     *
     * console.log(ntheory.continuedFraction('415/93'))                    //[4n, 2n, 6n, 7n]
     * console.log(ntheory.continuedFraction('sqrt(2)', {terms: 5}))       //[1n, 2n, 2n, 2n, 2n]
     * console.log(ntheory.continuedFraction('pi', {terms: 6}))            //[3n, 7n, 15n, 1n, 292n, 1n]
     * ```
     */
    public continuedFraction(value: Value, options?: ContinuedFractionOptions): bigint[] {
        const [expression, terms] = this.#continued(value, options)
        if (expression.isRational() === true) return NumberTheory.#rationalTerms(expression, terms)
        const last: number = NumberTheory.#lastDigits(terms)
        for (let digits: number = NumberTheory.#startDigits(terms); ; digits = globalThis.Math.min(2 * digits, last)) {
            const found: bigint[] | undefined = NumberTheory.#decimalTerms(expression.toDecimal(digits), digits, terms, digits === last)
            if (found) return found
        }
    }

    /**
     * `continuedFraction()` in the threads of the addon (its decimals).
     * @param value The number: a number, a bigint, a decimal, an expression without variables or a formula.
     * @param options The largest number of terms, the cancellation, the time limit.
     */
    public async continuedFractionAsync(value: Value, options?: ContinuedFractionOptions & AsyncOptions): Promise<bigint[]> {
        const [expression, terms] = this.#continued(value, options)
        if (expression.isRational() === true) return NumberTheory.#rationalTerms(expression, terms)
        const last: number = NumberTheory.#lastDigits(terms)
        for (let digits: number = NumberTheory.#startDigits(terms); ; digits = globalThis.Math.min(2 * digits, last)) {
            const found: bigint[] | undefined = NumberTheory.#decimalTerms(await expression.toDecimalAsync(digits, options), digits, terms, digits === last)
            if (found) return found
        }
    }

    //The numerators and the denominators of the convergents of terms
    static #convergents(terms: readonly IntegerValue[]): Fraction[] {
        if (!Array.isArray(terms) || terms.length === 0) throw new MathArgumentException('A continued fraction has terms')
        const convergents: Fraction[] = []
        let [p0, p1, q0, q1] = [0n, 1n, 1n, 0n]
        for (const term of terms) {
            if (typeof term !== 'bigint' && !Number.isSafeInteger(term)) throw new MathArgumentException(`The terms are integers: ${String(term)} is not`)
            const a: bigint = BigInt(term)
            ;[p0, p1] = [p1, a * p1 + p0]
            ;[q0, q1] = [q1, a * q1 + q0]
            convergents.push([p1, q1])
        }
        return convergents
    }

    #fraction([p, q]: Fraction): Expression {
        if (q === 0n) throw new MathDivisionByZeroException('The continued fraction has no value: a division by zero')
        return expressionOf(this.context, `${p}/${q}`)
    }

    /**
     * The value of a continued fraction, `a0 + 1/(a1 + 1/(a2 + …))`, an exact fraction. Its terms may be any integers;
     * where they make a division by zero, it throws `MathDivisionByZeroException`.
     * @param terms The terms, from `a0`.
     * @example
     * ```typescript
     * import {ntheory} from '@lakutata/math'
     *
     * console.log(ntheory.fromContinuedFraction([4, 2, 6, 7]).toString())   //415/93
     * ```
     */
    public fromContinuedFraction(terms: readonly IntegerValue[]): Expression {
        const convergents: Fraction[] = NumberTheory.#convergents(terms)
        return this.#fraction(convergents[convergents.length - 1])
    }

    /**
     * The convergents of a continued fraction: the values of its first terms, `a0`, `a0 + 1/a1`, …, exact fractions;
     * they are the best rational approximations of its value (no fraction of a smaller denominator is closer).
     * @param terms The terms, from `a0`.
     * @example
     * ```typescript
     * import {ntheory} from '@lakutata/math'
     *
     * console.log(ntheory.convergents([3, 7, 15, 1]).map(String))           //['3', '22/7', '333/106', '355/113']
     * ```
     */
    public convergents(terms: readonly IntegerValue[]): Expression[] {
        return NumberTheory.#convergents(terms).map((convergent: Fraction): Expression => this.#fraction(convergent))
    }
}
