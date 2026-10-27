import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {vectorOf, type VectorValue} from './Matrix.js'
import {nativeCall} from './Native.js'

/**
 * The names of the distributions of `math.stats`: continuous (`normal` … `inverseGamma`), then discrete
 */
export type DistributionName = 'normal' | 'lognormal' | 'uniform' | 'exponential' | 'gamma' | 'beta' | 'chiSquared' | 'studentT' | 'fisherF' | 'cauchy' | 'laplace' | 'logistic' | 'weibull' | 'pareto' | 'rayleigh' | 'triangular' | 'gumbel' | 'inverseGamma' | 'bernoulli' | 'binomial' | 'poisson' | 'geometric' | 'negativeBinomial' | 'hypergeometric'

/**
 * The parameters of a distribution, by their names
 */
export type DistributionParameters = Readonly<Record<string, number>>

//The parameters of each distribution, in the order of the addon, with their default values
const PARAMETERS: Record<DistributionName, [string, number?][]> = {
    normal: [['mean', 0], ['standardDeviation', 1]],
    lognormal: [['logMean', 0], ['logStandardDeviation', 1]],
    uniform: [['lower', 0], ['upper', 1]],
    exponential: [['rate', 1]],
    gamma: [['shape'], ['scale', 1]],
    beta: [['alpha'], ['beta']],
    chiSquared: [['degrees']],
    studentT: [['degrees']],
    fisherF: [['numeratorDegrees'], ['denominatorDegrees']],
    cauchy: [['location', 0], ['scale', 1]],
    laplace: [['location', 0], ['scale', 1]],
    logistic: [['location', 0], ['scale', 1]],
    weibull: [['shape'], ['scale', 1]],
    pareto: [['scale'], ['shape']],
    rayleigh: [['scale', 1]],
    triangular: [['lower'], ['mode'], ['upper']],
    gumbel: [['location', 0], ['scale', 1]],
    inverseGamma: [['shape'], ['scale', 1]],
    bernoulli: [['probability']],
    binomial: [['trials'], ['probability']],
    poisson: [['mean']],
    geometric: [['probability']],
    negativeBinomial: [['successes'], ['probability']],
    hypergeometric: [['total'], ['successes'], ['draws']]
}

//The states of the generators, which the samples advance: not a property of theirs
const STATES: WeakMap<RandomGenerator, BigUint64Array> = new WeakMap()

function distributionRun(args: unknown[]): Float64Array {
    return nativeCall((native) => native.run('distribution', args)) as Float64Array
}

/**
 * A generator of random numbers: xoshiro256** (Blackman and Vigna), its four words of state seeded by splitmix64. Of a
 * seed, it draws the same sequence each time: its uniform numbers and integers are the same on every platform, while
 * the samples of a distribution may differ in their last digits from one platform to another (they go through the
 * functions of its C library). It is not meant for cryptography.
 * @example
 * ```typescript
 * import {math, RandomGenerator} from '@lakutata/math'
 *
 * const random: RandomGenerator = math.stats.random(42)
 * random.next()                                         //a number of (0, 1)
 * random.integers(3, 1, 7)                              //three dice: Float64Array of integers of 1 to 6
 * math.stats.normal().sample(5, random)                 //Float64Array of 5 samples
 * ```
 */
export class RandomGenerator {

    readonly #state: BigUint64Array = new BigUint64Array(4)

    /**
     * A generator of a seed, or of a seed of the random numbers of the system.
     * @param seed An integer (a number or a bigint, taken modulo 2^64).
     */
    constructor(seed?: number | bigint) {
        const word: BigUint64Array = new BigUint64Array(1)
        if (seed === undefined) {
            globalThis.crypto.getRandomValues(word)
        } else {
            if (!(typeof seed === 'bigint' || Number.isSafeInteger(seed))) throw new MathArgumentException('A seed is a bigint or a safe integer')
            word[0] = BigInt.asUintN(64, BigInt(seed))
        }
        nativeCall((native) => native.run('random', ['seed', this.#state, word]))
        STATES.set(this, this.#state)
    }

    /**
     * A uniform number of (0, 1): never 0 nor 1.
     */
    public next(): number {
        return this.uniform(1)[0]
    }

    /**
     * Uniform numbers of (0, 1).
     * @param count How many.
     */
    public uniform(count: number): Float64Array {
        return nativeCall((native) => native.run('random', ['uniform', this.#state, count])) as Float64Array
    }

    /**
     * Uniform integers of `[lower, upper)` (the upper bound excluded, as mathjs's `randomInt` and NumPy's), without
     * bias.
     * @param count How many.
     * @param lower The smallest, a safe integer.
     * @param upper The integer above the largest.
     */
    public integers(count: number, lower: number, upper: number): Float64Array {
        return nativeCall((native) => native.run('random', ['integers', this.#state, count, lower, upper])) as Float64Array
    }

    /**
     * A generator of the same state, which draws the same sequence from now on.
     */
    public clone(): RandomGenerator {
        const copy: RandomGenerator = new RandomGenerator(0)
        copy.#state.set(this.#state)
        return copy
    }
}

/**
 * A probability distribution of `math.stats` (on Boost.Math), of its parameters by their names: its density (the
 * probability mass of a discrete one), its cumulative distribution and survival functions, its quantiles, its moments,
 * its samples. Its functions take a value, or values (an array of numbers, or a `Float64Array`) and give as many.
 *
 * As SciPy: outside the support, the density is 0 and the cdf 0 or 1; a discrete distribution has a mass of 0 at the
 * values that are not integers, and the cdf of the integer below them; its quantile of p is the smallest integer k of
 * `cdf(k) >= p` (`quantile(0)` is the lower bound of its support, where SciPy gives one below it). A probability
 * outside `[0, 1]` gives NaN. A mean or a variance that diverges is `Infinity`; a skewness or a kurtosis that diverges
 * is NaN, as a moment the distribution does not have (the mean of Cauchy's).
 * @example
 * ```typescript
 * import {type Distribution, math} from '@lakutata/math'
 *
 * const normal: Distribution = math.stats.normal({mean: 1, standardDeviation: 2})
 * normal.cdf(1)                                         //0.5
 * normal.quantile(0.975)                                //4.919927969080108
 * math.stats.binomial({trials: 10, probability: 0.3}).pdf([2, 3])   //Float64Array [0.23347444050000024, 0.2668279319999998]
 * ```
 */
export class Distribution {

    /**
     * Its parameters, all of them (the defaults included).
     */
    public readonly parameters: DistributionParameters

    /**
     * Whether its values are reals or integers.
     */
    public readonly kind: 'continuous' | 'discrete'

    /**
     * The lower and the upper bounds of its support (infinities where it is unbounded).
     */
    public readonly support: readonly [number, number]

    /**
     * Its mean, NaN where it has none.
     */
    public readonly mean: number

    /**
     * Its variance, NaN where it has none.
     */
    public readonly variance: number

    /**
     * Its standard deviation, NaN where it has none.
     */
    public readonly standardDeviation: number

    /**
     * Its median (the quantile of 1/2 of a discrete one).
     */
    public readonly median: number

    /**
     * Its mode.
     */
    public readonly mode: number

    /**
     * Its skewness, NaN where it has none.
     */
    public readonly skewness: number

    /**
     * Its excess kurtosis (the kurtosis minus 3, 0 for the normal distribution), NaN where it has none.
     */
    public readonly excessKurtosis: number

    readonly #values: number[]

    /**
     * A distribution of its name and its parameters (the ones not given take their default values), checked.
     * @param name The name of the distribution.
     * @param parameters Its parameters, by their names.
     */
    constructor(public readonly name: DistributionName, parameters: DistributionParameters = {}) {
        const names: [string, number?][] | undefined = Object.hasOwn(PARAMETERS, name) ? PARAMETERS[name] : undefined
        if (!names) throw new MathArgumentException(`Unknown distribution: ${String(name)}`)
        if (typeof parameters !== 'object' || parameters === null) throw new MathArgumentException('The parameters of a distribution are an object')
        for (const key of Object.keys(parameters)) {
            if (!names.some(([known]: [string, number?]): boolean => known === key)) throw new MathArgumentException(`The ${name} distribution has no parameter ${key} (${names.map(([known]: [string, number?]): string => known).join(', ')})`)
        }
        this.#values = names.map(([key, fallback]: [string, number?]): number => {
            const value: number | undefined = parameters[key] ?? fallback
            if (value === undefined) throw new MathArgumentException(`The ${name} distribution needs its parameter ${key}`)
            if (typeof value !== 'number') throw new MathArgumentException(`The parameter ${key} of the ${name} distribution is a number`)
            return value
        })
        this.parameters = Object.freeze(Object.fromEntries(names.map(([key]: [string, number?], i: number): [string, number] => [key, this.#values[i]])))
        const description: Float64Array = distributionRun(['describe', name, this.#values])
        this.kind = description[0] === 1 ? 'discrete' : 'continuous'
        this.support = Object.freeze([description[1], description[2]] as const)
        this.mean = description[3]
        this.variance = description[4]
        this.standardDeviation = Math.sqrt(description[4])
        this.median = description[5]
        this.mode = description[6]
        this.skewness = description[7]
        this.excessKurtosis = description[8]
    }

    #at(function_: string, values: number | VectorValue, what: string): number | Float64Array {
        const single: boolean = typeof values === 'number'
        const results: Float64Array = distributionRun([function_, this.name, this.#values, single ? Float64Array.of(values as number) : vectorOf(values as VectorValue, what)])
        return single ? results[0] : results
    }

    /**
     * The density (the probability mass of a discrete distribution) at a value, or at each of values.
     * @param x The value.
     */
    public pdf(x: number): number
    /**
     * @param x The values.
     */
    public pdf(x: VectorValue): Float64Array
    public pdf(x: number | VectorValue): number | Float64Array {
        return this.#at('pdf', x, 'The values')
    }

    /**
     * The cumulative distribution function: the probability of a value up to x.
     * @param x The value.
     */
    public cdf(x: number): number
    /**
     * @param x The values.
     */
    public cdf(x: VectorValue): Float64Array
    public cdf(x: number | VectorValue): number | Float64Array {
        return this.#at('cdf', x, 'The values')
    }

    /**
     * The survival function: the probability of a value above x, computed as such (not as `1 - cdf(x)`, which loses
     * the small probabilities).
     * @param x The value.
     */
    public survival(x: number): number
    /**
     * @param x The values.
     */
    public survival(x: VectorValue): Float64Array
    public survival(x: number | VectorValue): number | Float64Array {
        return this.#at('survival', x, 'The values')
    }

    /**
     * The quantile of a probability p (the inverse of the cdf; of a discrete distribution, the smallest integer k of
     * `cdf(k) >= p`).
     * @param p The probability, of `[0, 1]`.
     */
    public quantile(p: number): number
    /**
     * @param p The probabilities.
     */
    public quantile(p: VectorValue): Float64Array
    public quantile(p: number | VectorValue): number | Float64Array {
        return this.#at('quantile', p, 'The probabilities')
    }

    /**
     * The quantile of a probability q of the survival function (SciPy's `isf`): the value above which the probability
     * is q (of a discrete distribution, the smallest integer k of `survival(k) <= q`).
     * @param q The probability, of `[0, 1]`.
     */
    public survivalQuantile(q: number): number
    /**
     * @param q The probabilities.
     */
    public survivalQuantile(q: VectorValue): Float64Array
    public survivalQuantile(q: number | VectorValue): number | Float64Array {
        return this.#at('survivalQuantile', q, 'The probabilities')
    }

    /**
     * Samples of the distribution, by the inverse of its cdf at uniform numbers of a generator, which they advance.
     * @param count How many.
     * @param random The generator: one of the random numbers of the system by default.
     */
    public sample(count: number, random: RandomGenerator = new RandomGenerator()): Float64Array {
        if (!(random instanceof RandomGenerator)) throw new MathArgumentException('The generator of samples is a RandomGenerator')
        return distributionRun(['sample', this.name, this.#values, count, STATES.get(random)])
    }
}
