import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    Math,
    MathArgumentException,
    MathCancelledException,
    MathNotSupportedException,
    MathTimeoutException,
    type NumberTheory,
    type PrimeFactor
} from '../exports/Math.js'
import {Random} from './support/Fuzz.js'

//Whether n is a prime, by trial division (n below 2^53)
function primeByDivision(n: number): boolean {
    if (n < 2) return false
    for (let divisor: number = 2; divisor * divisor <= n; divisor++) {
        if (n % divisor === 0) return false
    }
    return true
}

//The odd composite numbers below a limit (at most 2^26: the products stay exact doubles) that pass the strong probable
//prime test to the base 2: the numbers Miller-Rabin alone takes for primes
function strongPseudoprimes(limit: number): number[] {
    const found: number[] = []
    for (let n: number = 3; n < limit; n += 2) {
        let odd: number = n - 1, twos: number = 0
        while (odd % 2 === 0) {
            odd /= 2
            twos++
        }
        let x: number = 1, base: number = 2
        for (let exponent: number = odd; exponent > 0; exponent = globalThis.Math.floor(exponent / 2)) {
            if (exponent % 2 === 1) x = x * base % n
            base = base * base % n
        }
        let passes: boolean = x === 1 || x === n - 1
        for (let r: number = 1; r < twos && !passes; r++) {
            x = x * x % n
            passes = x === n - 1
        }
        if (passes && !primeByDivision(n)) found.push(n)
    }
    return found
}

//A random bigint of up to a number of bits
function randomBigint(random: Random, bits: number): bigint {
    let value: bigint = 0n
    for (let i: number = 0; i < bits; i += 16) value = (value << 16n) | BigInt(random.int(65536))
    return value >> BigInt(globalThis.Math.max(0, globalThis.Math.ceil(bits / 16) * 16 - (1 + random.int(bits))))
}

function mod(a: bigint, m: bigint): bigint {
    return ((a % m) + m) % m
}

describe('The number theory', (): void => {
    let container: Container
    let ntheory: NumberTheory

    before(async (): Promise<void> => {
        container = new Container()
        await container.setNamed('math', Math, {})
        ntheory = (await container.get<Math>('math')).ntheory
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('tell the primes as trial division, and the strong pseudoprimes to the base 2 below 10^7 are composite', (): void => {
        for (let n: number = -10; n < 20000; n++) assert.strictEqual(ntheory.isPrime(n), primeByDivision(n), String(n))
        for (let n: number = 1000000; n < 1010000; n++) assert.strictEqual(ntheory.isPrime(n), primeByDivision(n), String(n))
        const pseudoprimes: number[] = strongPseudoprimes(10000000)
        assert.ok(pseudoprimes.includes(2047) && pseudoprimes.length > 40, `${pseudoprimes.length} pseudoprimes`)
        for (const n of pseudoprimes) assert.strictEqual(ntheory.isPrime(n), false, String(n))
    })

    it('keep the identities of the factors, the inverses, the congruences and the symbols on random integers', (): void => {
        const random: Random = new Random(20261026)
        for (let index: number = 0; index < 300; index++) {
            const n: bigint = randomBigint(random, 1 + random.int(80)) + 1n
            const factors: PrimeFactor[] = ntheory.factor(n)
            assert.strictEqual(factors.reduce((product: bigint, factor: PrimeFactor): bigint => product * factor.prime ** BigInt(factor.exponent), 1n), n, `factor(${n})`)
            for (const factor of factors) assert.ok(ntheory.isPrime(factor.prime), `factor(${n}): ${factor.prime}`)
            const a: bigint = randomBigint(random, 1 + random.int(100)) * (random.chance(0.3) ? -1n : 1n)
            const {gcd, x, y} = ntheory.extendedGcd(a, n)
            assert.strictEqual(a * x + n * y, gcd, `extendedGcd(${a}, ${n})`)
            assert.strictEqual(gcd, ntheory.gcd(a, n))
            const inverse: bigint | undefined = ntheory.modInverse(a, n)
            assert.strictEqual(inverse === undefined, gcd !== 1n, `modInverse(${a}, ${n})`)
            if (inverse !== undefined) assert.strictEqual(mod(a * inverse, n), mod(1n, n), `modInverse(${a}, ${n}) is ${inverse}`)
            const exponent: bigint = BigInt(random.int(60))
            assert.strictEqual(ntheory.powMod(a, exponent, n), mod(a ** exponent, n), `powMod(${a}, ${exponent}, ${n})`)
            const next: bigint = ntheory.nextPrime(n)
            assert.ok(next > n && ntheory.isPrime(next))
            if (n < 100000n) {
                for (let between: bigint = n + 1n; between < next; between++) assert.strictEqual(ntheory.isPrime(between), false, String(between))
            }
            //Two congruences of moduli not always coprime
            const m1: bigint = BigInt(1 + random.int(500)), m2: bigint = BigInt(1 + random.int(500))
            const r1: bigint = BigInt(random.int(1000) - 500), r2: bigint = BigInt(random.int(1000) - 500)
            const solution = ntheory.crt([r1, r2], [m1, m2])
            const common: bigint = ntheory.gcd(m1, m2)
            assert.strictEqual(solution === undefined, mod(r1 - r2, common) !== 0n, `crt(${r1}, ${r2}; ${m1}, ${m2})`)
            if (solution) assert.ok(mod(solution.remainder - r1, m1) === 0n && mod(solution.remainder - r2, m2) === 0n && solution.modulus === ntheory.lcm(m1, m2))
            //The Jacobi symbol: the product of the Legendre symbols over the factors of an odd n
            const odd: bigint = n % 2n === 0n ? n + 1n : n
            const expected: number = odd === 1n ? 1 : ntheory.factor(odd).reduce((product: number, factor: PrimeFactor): number => product * ntheory.legendre(a, factor.prime) ** factor.exponent, 1)
            //+ 0: a product of 0 and -1 is -0
            assert.strictEqual(ntheory.jacobi(a, odd), expected + 0, `jacobi(${a}, ${odd})`)
        }
        for (let n: number = 1; n < 300; n++) {
            let coprime: number = 0
            for (let k: number = 1; k <= n; k++) coprime += ntheory.gcd(k, n) === 1n ? 1 : 0
            assert.strictEqual(ntheory.totient(n), BigInt(coprime), `totient(${n})`)
        }
    })

    it('give the same results asynchronously, stop a long factorization, and refuse other values than integers', async (): Promise<void> => {
        const n: bigint = 2n ** 64n + 1n
        assert.deepStrictEqual(await ntheory.factorAsync(n), ntheory.factor(n))
        assert.strictEqual(await ntheory.isPrimeAsync(2n ** 127n - 1n), true)
        assert.strictEqual(await ntheory.nextPrimeAsync(n), ntheory.nextPrime(n))
        assert.strictEqual(await ntheory.totientAsync(n), ntheory.totient(n))
        assert.strictEqual(await ntheory.mobiusAsync(n), ntheory.mobius(n))
        assert.strictEqual(await ntheory.primitiveRootAsync(2n ** 61n - 1n), ntheory.primitiveRoot(2n ** 61n - 1n))
        //Two primes of 22 digits: far beyond a quarter of a second
        const hard: bigint = 1000000000000000000000007n * 1000000000000000000000049n
        await assert.rejects(ntheory.factorAsync(hard, {timeout: 250}), MathTimeoutException)
        const controller: AbortController = new AbortController()
        setTimeout((): void => controller.abort(), 100)
        await assert.rejects(ntheory.factorAsync(hard, {signal: controller.signal}), MathCancelledException)
        for (const value of [1.5, 2 ** 53, Number.NaN, '5', null]) assert.throws((): unknown => ntheory.mod(value as number, 7), MathArgumentException, String(value))
        //Modulo 1 every number is 0, its own inverse (Python's pow(5, -1, 1) is 0; SymPy refuses)
        assert.strictEqual(ntheory.modInverse(5, 1), 0n)
        assert.strictEqual(ntheory.mod(-0, 7), 0n)
        assert.strictEqual(ntheory.binomial(10n ** 100n, 2), 10n ** 100n * (10n ** 100n - 1n) / 2n)
        assert.throws((): unknown => ntheory.factorial(80000), MathNotSupportedException)
        assert.throws((): unknown => ntheory.bernoulli(2001), MathNotSupportedException)
        assert.strictEqual(ntheory.factorial(30000).toString().length, 121288)
    })
})
