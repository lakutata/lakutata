import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type Context} from './Context.js'
import {vectorOf, type VectorValue} from './Matrix.js'
import {nativeCall} from './Native.js'
import {Distribution, type DistributionName, type DistributionParameters, RandomGenerator} from './Distribution.js'

/**
 * The divisor of a sum of squared deviations (of a variance, a standard deviation, a covariance): `'uncorrected'`, n
 * (the values are the whole population); `'unbiased'`, n - 1 (they are a sample of it); `'biased'`, n + 1
 */
export type Normalization = 'uncorrected' | 'unbiased' | 'biased'

/**
 * The options of a variance, a standard deviation, a covariance or z-scores
 */
export interface NormalizationOptions {
    /**
     * The divisor of the sum of squared deviations: `'uncorrected'` (n) by default.
     */
    normalization?: Normalization
}

const NORMALIZATIONS: Record<Normalization, number> = {uncorrected: 0, unbiased: 1, biased: 2}

function normalizationOf(options: NormalizationOptions | undefined): number[] {
    const normalization: Normalization = options?.normalization ?? 'uncorrected'
    if (!Object.hasOwn(NORMALIZATIONS, normalization)) throw new MathArgumentException('The normalization is \'uncorrected\', \'unbiased\' or \'biased\'')
    return [NORMALIZATIONS[normalization]]
}

function statisticsRun(operation: string, vectors: Float64Array[], numbers: number[] = []): Float64Array[] {
    return nativeCall((native) => native.run('stats', [operation, vectors, numbers])) as Float64Array[]
}

function numberOf(operation: string, values: VectorValue, numbers: number[] = []): number {
    return statisticsRun(operation, [vectorOf(values, 'The values')], numbers)[0][0]
}

/**
 * The statistics of values (a `Float64Array`, or an array of numbers), computed by the addon: sums compensated for
 * their roundings, means, medians, modes, variances and standard deviations, quantiles, covariances and correlations,
 * z-scores, the Kullback-Leibler divergence; and 24 probability distributions (`normal()` … `hypergeometric()`,
 * `distribution()`) on Boost.Math, with a generator of random numbers for their samples (`random()`). It is
 * `MathScope.stats`; the package exports the one of `math` as `stats`.
 *
 * A variance divides the sum of the squared deviations by n by default (`'uncorrected'`: the values are the whole
 * population, as in NumPy); `{normalization: 'unbiased'}` divides it by n - 1 (a sample, as the default of mathjs). A
 * quantile interpolates linearly between the values around it (as NumPy's and mathjs's). A NaN among the values gives
 * NaN; no values throw `MathArgumentException` where the statistic has none.
 * @example
 * ```typescript
 * import {math} from '@lakutata/math'
 *
 * const values: number[] = [2, 4, 4, 4, 5, 5, 7, 9]
 * math.stats.mean(values)                                          //5
 * math.stats.standardDeviation(values)                             //2
 * math.stats.standardDeviation(values, {normalization: 'unbiased'}) //2.138089935299395
 * math.stats.median(values)                                        //4.5
 * math.stats.quantile(values, [0.25, 0.75])                        //Float64Array [4, 5.5]
 * ```
 */
export class Statistics {

    /**
     * The statistics of a scope.
     * @param context The context of the scope.
     */
    constructor(protected readonly context: Context) {
    }

    /**
     * The sum of the values, compensated for its roundings (Neumaier's): `sum([0.1, 0.2, 0.3])` is 0.6. 0 of no
     * values.
     * @param values The values.
     */
    public sum(values: VectorValue): number {
        return numberOf('sum', values)
    }

    /**
     * The product of the values. 1 of no values.
     * @param values The values.
     */
    public product(values: VectorValue): number {
        return numberOf('prod', values)
    }

    /**
     * The sums of the values up to each of them, compensated as `sum()`.
     * @param values The values.
     */
    public cumulativeSum(values: VectorValue): Float64Array {
        return statisticsRun('cumsum', [vectorOf(values, 'The values')])[0]
    }

    /**
     * The differences of the values that follow each other: `values[i + 1] - values[i]`.
     * @param values The values.
     */
    public differences(values: VectorValue): Float64Array {
        return statisticsRun('diff', [vectorOf(values, 'The values')])[0]
    }

    /**
     * The mean of the values (their compensated sum divided by their number).
     * @param values The values, at least one.
     */
    public mean(values: VectorValue): number {
        return numberOf('mean', values)
    }

    /**
     * The median of the values: the middle one, or the mean of the two in the middle.
     * @param values The values, at least one.
     */
    public median(values: VectorValue): number {
        return numberOf('median', values)
    }

    /**
     * The values that occur most often, ascending.
     * @param values The values, at least one.
     */
    public mode(values: VectorValue): Float64Array {
        return statisticsRun('mode', [vectorOf(values, 'The values')])[0]
    }

    /**
     * The smallest of the values.
     * @param values The values, at least one.
     */
    public min(values: VectorValue): number {
        return numberOf('min', values)
    }

    /**
     * The largest of the values.
     * @param values The values, at least one.
     */
    public max(values: VectorValue): number {
        return numberOf('max', values)
    }

    /**
     * The variance of the values: the sum of their squared deviations from their mean, divided by n (by default), n - 1
     * or n + 1. NaN for one value with the normalization `'unbiased'`.
     * @param values The values, at least one.
     * @param options The normalization.
     */
    public variance(values: VectorValue, options?: NormalizationOptions): number {
        return numberOf('variance', values, normalizationOf(options))
    }

    /**
     * The standard deviation of the values: the square root of their variance.
     * @param values The values, at least one.
     * @param options The normalization.
     */
    public standardDeviation(values: VectorValue, options?: NormalizationOptions): number {
        return numberOf('std', values, normalizationOf(options))
    }

    /**
     * The median absolute deviation of the values: the median of their distances to their median (mathjs's `mad`,
     * SciPy's `median_abs_deviation`, unscaled).
     * @param values The values, at least one.
     */
    public medianAbsoluteDeviation(values: VectorValue): number {
        return numberOf('mad', values)
    }

    /**
     * The quantile of a probability p: the value at the index `(n - 1) p` of the values sorted, interpolated linearly
     * between the two around it (NumPy's default method, mathjs's `quantileSeq`). Of several probabilities, the
     * quantile of each.
     * @param values The values, at least one.
     * @param probability The probability, from 0 to 1.
     */
    public quantile(values: VectorValue, probability: number): number
    /**
     * @param values The values, at least one.
     * @param probabilities The probabilities, from 0 to 1.
     */
    public quantile(values: VectorValue, probabilities: VectorValue): Float64Array
    public quantile(values: VectorValue, probabilities: number | VectorValue): number | Float64Array {
        const single: boolean = typeof probabilities === 'number'
        const quantiles: Float64Array = statisticsRun('quantile', [vectorOf(values, 'The values'), single ? Float64Array.of(probabilities as number) : vectorOf(probabilities as VectorValue, 'The probabilities')])[0]
        return single ? quantiles[0] : quantiles
    }

    /**
     * The covariance of two vectors of values of the same length: the sum of the products of their deviations from
     * their means, divided by n (by default), n - 1 or n + 1.
     * @param x The first values.
     * @param y The second values.
     * @param options The normalization.
     */
    public covariance(x: VectorValue, y: VectorValue, options?: NormalizationOptions): number {
        return statisticsRun('cov', [vectorOf(x, 'The first values'), vectorOf(y, 'The second values')], normalizationOf(options))[0][0]
    }

    /**
     * The correlation coefficient of two vectors of values of the same length (Pearson's), from -1 to 1; NaN where
     * the values of one of them are all equal.
     * @param x The first values.
     * @param y The second values.
     */
    public correlation(x: VectorValue, y: VectorValue): number {
        return statisticsRun('corr', [vectorOf(x, 'The first values'), vectorOf(y, 'The second values')])[0][0]
    }

    /**
     * The z-scores of the values: their deviations from their mean divided by their standard deviation (SciPy's
     * `zscore`).
     * @param values The values.
     * @param options The normalization of the standard deviation.
     */
    public zScores(values: VectorValue, options?: NormalizationOptions): Float64Array {
        return statisticsRun('zscore', [vectorOf(values, 'The values')], normalizationOf(options))[0]
    }

    /**
     * The Kullback-Leibler divergence of a distribution p from a distribution q, `Σ p log(p / q)` with the natural
     * logarithm, each scaled to a sum of 1 first (mathjs's `kldivergence`, SciPy's `entropy(p, q)`): a term where p is
     * 0 is 0; one where q is 0 and p is not is infinite.
     * @param p The probabilities of p, not negative.
     * @param q The probabilities of q, as many, not negative.
     */
    public klDivergence(p: VectorValue, q: VectorValue): number {
        return statisticsRun('kldivergence', [vectorOf(p, 'The probabilities of p'), vectorOf(q, 'The probabilities of q')])[0][0]
    }

    /**
     * The normal distribution (Gauss's) of a mean and a standard deviation: SciPy's `norm(loc=mean,
     * scale=standardDeviation)`.
     * @param parameters Its mean (0 by default) and its standard deviation (1 by default).
     */
    public normal(parameters: {mean?: number, standardDeviation?: number} = {}): Distribution {
        return new Distribution('normal', parameters)
    }

    /**
     * The log-normal distribution: of a value whose logarithm is normal, of mean `logMean` (μ) and standard deviation
     * `logStandardDeviation` (σ). SciPy's `lognorm(s=σ, scale=exp(μ))`.
     * @param parameters The mean (0 by default) and the standard deviation (1 by default) of the logarithm.
     */
    public lognormal(parameters: {logMean?: number, logStandardDeviation?: number} = {}): Distribution {
        return new Distribution('lognormal', parameters)
    }

    /**
     * The continuous uniform distribution between two bounds: SciPy's `uniform(loc=lower, scale=upper - lower)`.
     * @param parameters Its bounds (0 and 1 by default).
     */
    public uniform(parameters: {lower?: number, upper?: number} = {}): Distribution {
        return new Distribution('uniform', parameters)
    }

    /**
     * The exponential distribution of a rate λ (its mean is 1/λ): SciPy's `expon(scale=1/rate)`.
     * @param parameters Its rate (1 by default).
     */
    public exponential(parameters: {rate?: number} = {}): Distribution {
        return new Distribution('exponential', parameters)
    }

    /**
     * The gamma distribution of a shape k and a scale θ (its mean is kθ; the rate is 1/θ): SciPy's `gamma(a=shape,
     * scale=scale)`.
     * @param parameters Its shape and its scale (1 by default).
     */
    public gamma(parameters: {shape: number, scale?: number}): Distribution {
        return new Distribution('gamma', parameters)
    }

    /**
     * The beta distribution of two shapes α and β, on [0, 1]: SciPy's `beta(a=alpha, b=beta)`.
     * @param parameters Its shapes.
     */
    public beta(parameters: {alpha: number, beta: number}): Distribution {
        return new Distribution('beta', parameters)
    }

    /**
     * The chi-squared distribution of a number of degrees of freedom: SciPy's `chi2(df=degrees)`.
     * @param parameters Its degrees of freedom.
     */
    public chiSquared(parameters: {degrees: number}): Distribution {
        return new Distribution('chiSquared', parameters)
    }

    /**
     * Student's t distribution of a number of degrees of freedom: SciPy's `t(df=degrees)`.
     * @param parameters Its degrees of freedom.
     */
    public studentT(parameters: {degrees: number}): Distribution {
        return new Distribution('studentT', parameters)
    }

    /**
     * The F distribution (Fisher-Snedecor's) of the degrees of freedom of its numerator and of its denominator: SciPy's
     * `f(dfn, dfd)`.
     * @param parameters The degrees of freedom of the numerator and of the denominator.
     */
    public fisherF(parameters: {numeratorDegrees: number, denominatorDegrees: number}): Distribution {
        return new Distribution('fisherF', parameters)
    }

    /**
     * The Cauchy distribution (it has no mean and no variance): SciPy's `cauchy(loc=location, scale=scale)`.
     * @param parameters Its location (0 by default) and its scale (1 by default).
     */
    public cauchy(parameters: {location?: number, scale?: number} = {}): Distribution {
        return new Distribution('cauchy', parameters)
    }

    /**
     * The Laplace distribution (the double exponential): SciPy's `laplace(loc=location, scale=scale)`.
     * @param parameters Its location (0 by default) and its scale (1 by default).
     */
    public laplace(parameters: {location?: number, scale?: number} = {}): Distribution {
        return new Distribution('laplace', parameters)
    }

    /**
     * The logistic distribution: SciPy's `logistic(loc=location, scale=scale)`.
     * @param parameters Its location (0 by default) and its scale (1 by default).
     */
    public logistic(parameters: {location?: number, scale?: number} = {}): Distribution {
        return new Distribution('logistic', parameters)
    }

    /**
     * The Weibull distribution of a shape k and a scale λ: SciPy's `weibull_min(c=shape, scale=scale)`.
     * @param parameters Its shape and its scale (1 by default).
     */
    public weibull(parameters: {shape: number, scale?: number}): Distribution {
        return new Distribution('weibull', parameters)
    }

    /**
     * The Pareto distribution (of the first kind) of a scale xₘ, its smallest value, and a shape α: SciPy's
     * `pareto(b=shape, scale=scale)`.
     * @param parameters Its scale and its shape.
     */
    public pareto(parameters: {scale: number, shape: number}): Distribution {
        return new Distribution('pareto', parameters)
    }

    /**
     * The Rayleigh distribution of a scale σ: SciPy's `rayleigh(scale=scale)`.
     * @param parameters Its scale (1 by default).
     */
    public rayleigh(parameters: {scale?: number} = {}): Distribution {
        return new Distribution('rayleigh', parameters)
    }

    /**
     * The triangular distribution of its bounds and its mode: SciPy's `triang(c=(mode - lower)/(upper - lower),
     * loc=lower, scale=upper - lower)`.
     * @param parameters Its lower bound, its mode and its upper bound.
     */
    public triangular(parameters: {lower: number, mode: number, upper: number}): Distribution {
        return new Distribution('triangular', parameters)
    }

    /**
     * The Gumbel distribution (of the maxima: the extreme value distribution of type I): SciPy's
     * `gumbel_r(loc=location, scale=scale)`.
     * @param parameters Its location (0 by default) and its scale (1 by default).
     */
    public gumbel(parameters: {location?: number, scale?: number} = {}): Distribution {
        return new Distribution('gumbel', parameters)
    }

    /**
     * The inverse gamma distribution: the distribution of 1/X, X of a gamma distribution of the same shape and a rate
     * equal to this scale. SciPy's `invgamma(a=shape, scale=scale)`.
     * @param parameters Its shape and its scale (1 by default).
     */
    public inverseGamma(parameters: {shape: number, scale?: number}): Distribution {
        return new Distribution('inverseGamma', parameters)
    }

    /**
     * The Bernoulli distribution: 1 with a probability p, 0 otherwise. SciPy's `bernoulli(p)`.
     * @param parameters The probability of 1.
     */
    public bernoulli(parameters: {probability: number}): Distribution {
        return new Distribution('bernoulli', parameters)
    }

    /**
     * The binomial distribution: the number of successes of n trials, each of a probability p. SciPy's `binom(n, p)`.
     * @param parameters The number of trials (an integer) and the probability of a success.
     */
    public binomial(parameters: {trials: number, probability: number}): Distribution {
        return new Distribution('binomial', parameters)
    }

    /**
     * The Poisson distribution of a mean λ: SciPy's `poisson(mu)`.
     * @param parameters Its mean.
     */
    public poisson(parameters: {mean: number}): Distribution {
        return new Distribution('poisson', parameters)
    }

    /**
     * The geometric distribution: the number of trials up to the first success, each of a probability p, from 1
     * (SciPy's `geom(p)`, NumPy's; Boost counts the failures before it).
     * @param parameters The probability of a success.
     */
    public geometric(parameters: {probability: number}): Distribution {
        return new Distribution('geometric', parameters)
    }

    /**
     * The negative binomial distribution: the number of failures before the r-th success, each trial of a probability p
     * (r need not be an integer). SciPy's `nbinom(n=successes, p)`.
     * @param parameters The number of successes r and the probability of a success.
     */
    public negativeBinomial(parameters: {successes: number, probability: number}): Distribution {
        return new Distribution('negativeBinomial', parameters)
    }

    /**
     * The hypergeometric distribution: the number of successes among draws without replacement from a population of
     * `total` items, `successes` of which are successes. SciPy's `hypergeom(M=total, n=successes, N=draws)`.
     * @param parameters The size of the population, its number of successes and the number of draws (integers).
     */
    public hypergeometric(parameters: {total: number, successes: number, draws: number}): Distribution {
        return new Distribution('hypergeometric', parameters)
    }

    /**
     * A distribution of its name and its parameters, by their names (as the methods of each distribution).
     * @param name The name of the distribution.
     * @param parameters Its parameters.
     */
    public distribution(name: DistributionName, parameters?: DistributionParameters): Distribution {
        return new Distribution(name, parameters)
    }

    /**
     * A generator of random numbers (xoshiro256**) for the samples of the distributions: of a seed, the same sequence
     * each time; without one, a seed of the random numbers of the system.
     * @param seed An integer (a number or a bigint).
     */
    public random(seed?: number | bigint): RandomGenerator {
        return new RandomGenerator(seed)
    }
}
