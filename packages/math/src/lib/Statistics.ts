import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {type Context} from './Context.js'
import {vectorOf, type VectorValue} from './Matrix.js'
import {nativeCall} from './Native.js'

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
 * z-scores, the Kullback-Leibler divergence. It is `math.stats` of a `Math` component.
 *
 * A variance divides the sum of the squared deviations by n by default (`'uncorrected'`: the values are the whole
 * population, as in NumPy); `{normalization: 'unbiased'}` divides it by n - 1 (a sample, as the default of mathjs). A
 * quantile interpolates linearly between the values around it (as NumPy's and mathjs's). A NaN among the values gives
 * NaN; no values throw `MathArgumentException` where the statistic has none.
 * @example
 * ```typescript
 * import {Container} from 'lakutata'
 * import {Math} from '@lakutata/math'
 *
 * const container: Container = new Container()
 * await container.setNamed('math', Math, {})
 * const math: Math = await container.get<Math>('math')
 * const values: number[] = [2, 4, 4, 4, 5, 5, 7, 9]
 * math.stats.mean(values)                                          //5
 * math.stats.standardDeviation(values)                             //2
 * math.stats.standardDeviation(values, {normalization: 'unbiased'}) //2.138089935299395
 * math.stats.median(values)                                        //4.5
 * math.stats.quantile(values, [0.25, 0.75])                        //Float64Array [4, 5.5]
 * await container.destroy()
 * ```
 */
export class Statistics {

    /**
     * The statistics of a component.
     * @param context The context of the component.
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
}
