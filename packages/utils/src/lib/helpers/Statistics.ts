import {
    min,
    max,
    sum,
    quantile,
    product,
    mean,
    average,
    addToMean,
    mode,
    median,
    harmonicMean,
    geometricMean,
    rootMeanSquare,
    sampleSkewness,
    variance,
    sampleVariance,
    standardDeviation,
    sampleStandardDeviation,
    medianAbsoluteDeviation,
    interquartileRange,
    sumNthPowerDeviations,
    zScore,
    sampleCorrelation,
    sampleCovariance,
    linearRegression,
    linearRegressionLine,
    rSquared,
    shuffle,
    sampleWithReplacement,
    sample,
    bernoulliDistribution,
    binomialDistribution,
    poissonDistribution,
    tTest,
    tTestTwoSample,
    chunk,
    epsilon,
    factorial,
    gamma,
    approxEqual,
    bisect,
    coefficientOfVariation,
    combinationsReplacement,
    combinations,
    combineMeans,
    combineVariances,
    cumulativeStdLogisticProbability,
    extent,
    gammaln,
    jenks,
    logAverage,
    logit, probit,
    quantileRank,
    quickselect,
    subtractFromMean
} from './internal/SimpleStatistics.js'
import {type LinearRegression} from '../../types/LinearRegression.js'

/**
 * Descriptive statistics, regressions, distributions and random sampling on arrays of numbers, as static methods (the
 * simple-statistics library). The methods do not modify the arrays given; the ones needing a sorted array copy it first.
 * Most of them throw an `Error` for an empty array (or too short: two numbers for the sample variance), and propagate
 * `NaN`.
 * @example
 * ```typescript
 * import {Statistics} from 'lakutata/utils'
 *
 * const latencies: number[] = [12, 15, 11, 90, 14, 13]
 * console.log(Statistics.mean(latencies), Statistics.median(latencies), Statistics.quantile(latencies, 0.9))
 * //25.833333333333332 13.5 90
 * console.log(Statistics.min(latencies), Statistics.max(latencies), Statistics.standardDeviation(latencies).toFixed(2))
 * //11 90 28.73
 * //A trend: y = 2x + 1
 * console.log(Statistics.linearRegression([[0, 1], [2, 5]]))
 * //{m: 2, b: 1}
 * ```
 */
export class Statistics {

    /**
     * The stopping tolerance of the iterative computations (`binomialDistribution`, `poissonDistribution`, the default
     * tolerance of `approxEqual`): `0.0001`. Changing it has no effect on them: they read their own copy.
     */
    public static epsilon: number = epsilon

    /**
     * Get the smallest number of an array, in linear time.
     * @param x The numbers. A `NaN` among them gives `NaN`.
     * @returns The smallest number.
     * @throws {Error} When `x` is empty.
     */
    public static min(x: number[]): number {
        return min(x)
    }

    /**
     * Get the largest number of an array, in linear time.
     * @param x The numbers. A `NaN` among them gives `NaN`.
     * @returns The largest number.
     * @throws {Error} When `x` is empty.
     */
    public static max(x: number[]): number {
        return max(x)
    }

    /**
     * Add the numbers of an array, with Kahan-Babuska compensation (fewer rounding errors than a plain loop).
     * @param x The numbers; an empty array gives `0`.
     * @returns The sum.
     */
    public static sum(x: number[]): number {
        return sum(x)
    }

    /**
     * Get a quantile of an array: the value below which a fraction `p` of the numbers fall (`0.5` is the median, `0.25`
     * the first quartile). Between two numbers, the quantile is their mean. The array is copied before it is sorted.
     * @param x The numbers.
     * @param p The fraction, from 0 to 1.
     * @returns The quantile.
     * @throws {Error} When `x` is empty, or when `p` is out of 0 to 1.
     */
    public static quantile(x: number[], p: number): number {
        return quantile(x, p)
    }

    /**
     * Multiply the numbers of an array.
     * @param x The numbers; an empty array gives `1`.
     * @returns The product.
     */
    public static product(x: number[]): number {
        return product(x)
    }

    /**
     * Get the arithmetic mean of an array: the sum of its numbers divided by their count.
     * @param x The numbers. A `NaN` among them gives `NaN`.
     * @returns The mean.
     * @throws {Error} When `x` is empty.
     */
    public static mean(x: number[]): number {
        return mean(x)
    }

    /**
     * Get the arithmetic mean of an array; the same as `mean`.
     * @param x The numbers.
     * @returns The mean.
     * @throws {Error} When `x` is empty.
     */
    public static average(x: number[]): number {
        return average(x)
    }

    /**
     * Update a mean with a new value, without the list it was computed from: `(mean * n + newValue) / (n + 1)`.
     * @param mean The current mean.
     * @param n The count of numbers the mean was computed from.
     * @param newValue The number added.
     * @returns The mean of the `n + 1` numbers.
     */
    public static addToMean(mean: number, n: number, newValue: number): number {
        return addToMean(mean, n, newValue)
    }

    /**
     * Update a mean with a new value; the same as `addToMean`.
     * @param average The current mean.
     * @param n The count of numbers the mean was computed from.
     * @param newValue The number added.
     * @returns The mean of the `n + 1` numbers.
     */
    public static addToAverage(average: number, n: number, newValue: number): number {
        return addToMean(average, n, newValue)
    }

    /**
     * Get the mode of an array: the number which appears most often. On a tie, the smallest of the most frequent
     * numbers. Runs in O(n log n) (the array is copied and sorted).
     * @param x The numbers.
     * @returns The most frequent number.
     * @throws {Error} When `x` is empty.
     */
    public static mode(x: number[]): number {
        return mode(x)
    }

    /**
     * Get the median of an array: its middle number once sorted, or the mean of the two middle numbers for an even
     * count. Less sensitive to the outliers than the mean. The array is copied before it is sorted.
     * @param x The numbers.
     * @returns The median.
     * @throws {Error} When `x` is empty.
     */
    public static median(x: number[]): number {
        return median(x)
    }

    /**
     * Get the harmonic mean of an array: the reciprocal of the mean of the reciprocals, the mean suited to rates
     * (speeds, prices per unit).
     * @param x The numbers, all positive.
     * @returns The harmonic mean.
     * @throws {Error} When `x` is empty, or a number is zero or negative.
     */
    public static harmonicMean(x: number[]): number {
        return harmonicMean(x)
    }

    /**
     * Get the geometric mean of an array: the n-th root of the product of its n numbers, the mean suited to growth
     * rates (the mean of the factors 1.8, 1.17 and 1.43 gives the constant yearly growth with the same result).
     * @param x The numbers, none negative.
     * @returns The geometric mean.
     * @throws {Error} When `x` is empty, or a number is negative.
     */
    public static geometricMean(x: number[]): number {
        return geometricMean(x)
    }

    /**
     * Get the root mean square of an array: the square root of the mean of the squares, the magnitude of the numbers
     * whatever their sign.
     * @param x The numbers.
     * @returns The root mean square.
     * @throws {Error} When `x` is empty.
     */
    public static rootMeanSquare(x: number[]): number {
        return rootMeanSquare(x)
    }

    /**
     * Get the sample skewness of an array: how much its distribution leans to one side of the mean (negative: a longer
     * tail of small values; positive: of large values), the adjusted Fisher-Pearson coefficient of Excel, SPSS and SAS.
     * @param x The numbers, at least three.
     * @returns The skewness; `NaN` when all the numbers are equal.
     * @throws {Error} When `x` has fewer than three numbers.
     */
    public static sampleSkewness(x: number[]): number {
        return sampleSkewness(x)
    }

    /**
     * Get the population variance of an array: the mean of the squared deviations from the mean (divided by `n`). For a
     * sample of a larger population, use `sampleVariance`.
     * @param x The numbers; a single number gives `0`.
     * @returns The variance.
     * @throws {Error} When `x` is empty.
     */
    public static variance(x: number[]): number {
        return variance(x)
    }

    /**
     * Get the sample variance of an array: the squared deviations from the mean divided by `n - 1` (Bessel's
     * correction), the unbiased estimate of a population's variance from a sample of it.
     * @param x The numbers, at least two.
     * @returns The sample variance.
     * @throws {Error} When `x` has fewer than two numbers.
     */
    public static sampleVariance(x: number[]): number {
        return sampleVariance(x)
    }

    /**
     * Get the population standard deviation of an array: the square root of `variance`. For a sample of a larger
     * population, use `sampleStandardDeviation`.
     * @param x The numbers; a single number gives `0`.
     * @returns The standard deviation.
     * @throws {Error} When `x` is empty.
     */
    public static standardDeviation(x: number[]): number {
        return standardDeviation(x)
    }

    /**
     * Get the sample standard deviation of an array: the square root of `sampleVariance`.
     * @param x The numbers, at least two.
     * @returns The sample standard deviation.
     * @throws {Error} When `x` has fewer than two numbers.
     */
    public static sampleStandardDeviation(x: number[]): number {
        return sampleStandardDeviation(x)
    }

    /**
     * Get the median absolute deviation of an array: the median of the distances to the median, a measure of the spread
     * more robust to the outliers than the standard deviation.
     * @param x The numbers.
     * @returns The median absolute deviation.
     * @throws {Error} When `x` is empty.
     */
    public static medianAbsoluteDeviation(x: number[]): number {
        return medianAbsoluteDeviation(x)
    }

    /**
     * Get the interquartile range of an array: the third quartile minus the first one, the spread of its middle half.
     * @param x The numbers.
     * @returns The interquartile range.
     * @throws {Error} When `x` is empty.
     */
    public static interquartileRange(x: number[]): number {
        return interquartileRange(x)
    }

    /**
     * Add the deviations from the mean raised to a power: `n = 2` gives the sum of the squared deviations, `n = 3` the
     * sum of the cubed ones.
     * @param x The numbers.
     * @param n The power.
     * @returns The sum.
     * @throws {Error} When `x` is empty.
     */
    public static sumNthPowerDeviations(x: number[], n: number): number {
        return sumNthPowerDeviations(x, n)
    }

    /**
     * Get the z-score of a value: how many standard deviations it is above (positive) or below (negative) the mean. It
     * needs the population's mean and standard deviation; with a sample's ones, it is a t-statistic.
     * @param x The value.
     * @param mean The population's mean.
     * @param standardDeviation The population's standard deviation; `0` gives an infinity (or `NaN` for `x` at the
     * mean).
     * @returns The z-score.
     */
    public static zScore(x: number, mean: number, standardDeviation: number): number {
        return zScore(x, mean, standardDeviation)
    }

    /**
     * Get the sample correlation of two arrays (Pearson's r): from `-1` (one goes down when the other goes up) to `1`
     * (they go up together), `0` without linear relation.
     * @param x The first numbers.
     * @param y The second numbers, as many as `x`.
     * @returns The correlation; `NaN` when either array has all its numbers equal.
     * @throws {Error} When the arrays have different lengths, or fewer than two numbers.
     */
    public static correlation(x: number[], y: number[]): number {
        return sampleCorrelation(x, y)
    }

    /**
     * Get the sample covariance of two arrays: how much they vary together (divided by `n - 1`). Positive when they go
     * up together, negative when one goes down as the other goes up.
     * @param x The first numbers.
     * @param y The second numbers, as many as `x`.
     * @returns The sample covariance.
     * @throws {Error} When the arrays have different lengths, or fewer than two numbers.
     */
    public static sampleCovariance(x: number[], y: number[]): number {
        return sampleCovariance(x, y)
    }

    /**
     * Get the coefficient of determination (R²) of the least squares line of points: how well the line fits them, from
     * `1` (all the points on the line) down (`0`: no better than their mean). It is computed against the line given by
     * `linearRegression`.
     * @param data The points, as `[x, y]` pairs (`[[0, 1], [1, 3], [2, 5]]`). Fewer than two points give `1`.
     * @returns The R² of the line.
     */
    public static rSquared(data: [number, number][]): number {
        return rSquared(data, this.linearRegressionLine(this.linearRegression(data)))
    }

    /**
     * Fit a line to points by least squares: the slope `m` and the intercept `b` of `y = mx + b`.
     * @param data The points, as `[x, y]` pairs (`[[0, 1], [1, 3], [2, 5]]`). A single point gives a horizontal line
     * through it; points all at the same `x` give `NaN`.
     * @returns The slope and the intercept.
     */
    public static linearRegression(data: [number, number][]): LinearRegression {
        return linearRegression(data)
    }

    /**
     * Turn the result of `linearRegression` into a function giving the `y` of an `x` on the line.
     * @param mb The slope `m` and the intercept `b`.
     * @returns The function `x => m * x + b`.
     */
    public static linearRegressionLine(mb: LinearRegression): (x: number) => number {
        return linearRegressionLine(mb)
    }

    /**
     * Shuffle an array (Fisher-Yates, with `Math.random`) into a new one; the array given is not modified.
     * @param x The numbers.
     * @returns A new array of the same numbers in a random order.
     */
    public static shuffle(x: number[]): number[] {
        return shuffle(x)
    }

    /**
     * Draw numbers from an array at random, with replacement: the same item may be drawn several times.
     * @param x The numbers to draw from; an empty array gives `[]`.
     * @param n The count of numbers drawn.
     * @returns A new array of `n` numbers.
     */
    public static sampleWithReplacement(x: number[], n: number): number[] {
        return sampleWithReplacement(x, n)
    }

    /**
     * Draw numbers from an array at random, without replacement: each item is drawn once at most, in a random order.
     * @param x The numbers to draw from.
     * @param n The count of numbers drawn; more than the length of `x` gives all of them (shuffled).
     * @returns A new array of `n` numbers at most.
     */
    public static sample(x: number[], n: number): number[] {
        return sample(x, n, Math.random)
    }

    /**
     * Pick one number of an array at random.
     * @param x The numbers.
     * @returns A number of `x`; `undefined` when `x` is empty (despite the return type).
     */
    public static randomPickOne(x: number[]): number {
        return this.sample(x, 1)[0]
    }

    /**
     * Pick numbers of an array at random, each item once at most; the same as `sample`.
     * @param x The numbers.
     * @param n The count of numbers picked; more than the length of `x` gives all of them (shuffled).
     * @returns A new array of `n` numbers at most.
     */
    public static randomPickMany(x: number[], n: number): number[] {
        return this.sample(x, n)
    }

    /**
     * Get the Bernoulli distribution of a probability: the probabilities of a failure (`0`) and of a success (`1`) of
     * one trial, such as a coin toss.
     * @param p The probability of success, from 0 to 1.
     * @returns `[1 - p, p]`.
     * @throws {Error} When `p` is out of 0 to 1.
     */
    public static bernoulliDistribution(p: number): number[] {
        return bernoulliDistribution(p)
    }

    /**
     * Get the binomial distribution: the probabilities of 0, 1, 2… successes in a number of independent trials. The
     * list stops once the probabilities add up to `1 - epsilon`, so it may be shorter than `trials + 1`.
     * @param trials The number of trials, a positive integer.
     * @param probability The probability of success of each trial, from 0 to 1.
     * @returns The probability of each count of successes, by count; `undefined` when `trials` is not a positive
     * integer or `probability` is out of 0 to 1.
     */
    public static binomialDistribution(trials: number, probability: number): number[] | undefined {
        return binomialDistribution(trials, probability)
    }

    /**
     * Get the Poisson distribution of a rate: the probabilities of 0, 1, 2… events in an interval, for events happening
     * independently at a known mean rate. The list stops once the probabilities add up to `1 - epsilon`.
     * @param lambda The mean count of events in the interval, positive.
     * @returns The probability of each count of events, by count; `undefined` when `lambda` is zero or negative.
     */
    public static poissonDistribution(lambda: number): number[] | undefined {
        return poissonDistribution(lambda)
    }

    /**
     * Compute the one-sample t-statistic: how far the sample's mean is from an expected mean, in standard errors. Look
     * it up in a t table (with `x.length - 1` degrees of freedom) to get the p-value. Note: it divides by the
     * population standard deviation of the sample (`standardDeviation`), not by the sample one.
     * @param x The sample.
     * @param expectedValue The mean assumed by the null hypothesis.
     * @returns The t-statistic; an infinity or `NaN` when the numbers of `x` are all equal (a single number included).
     * @throws {Error} When `x` is empty.
     */
    public static tTest(x: number[], expectedValue: number): number {
        return tTest(x, expectedValue)
    }

    /**
     * Compute the two-sample t-statistic (Student's, equal variances assumed) of the hypothesis `mean(sampleX) -
     * mean(sampleY) = difference`; usually `difference` is `0`, to test whether both samples come from populations of
     * the same mean. Look it up in a t table to get the p-value.
     * @param sampleX The first sample, at least two numbers.
     * @param sampleY The second sample, at least two numbers.
     * @param difference The difference of the means assumed by the null hypothesis; `0` by default.
     * @returns The t-statistic; `null` when a sample is empty.
     * @throws {Error} When a sample has a single number.
     */
    public static tTestTwoSample(sampleX: number[], sampleY: number[], difference: number = 0): number | null {
        return tTestTwoSample(sampleX, sampleY, difference)
    }

    /**
     * Split an array into chunks of a given size, the last one smaller when the length is not a multiple of it (as
     * PHP's `array_chunk`).
     * @param x The items; an empty array gives `[]`.
     * @param chunkSize The size of the chunks, a positive integer.
     * @returns A new array of chunks.
     * @throws {Error} When `chunkSize` is not a positive integer.
     */
    public static chunk(x: number[], chunkSize: number): number[][] {
        return chunk(x, chunkSize)
    }

    /**
     * Compute the factorial of an integer: `n! = 1 * 2 * … * n`, with `0! = 1`.
     * @param n A non-negative integer. Beyond 170 the result is `Infinity`, and beyond 18 it is not exact.
     * @returns `n!`.
     * @throws {Error} When `n` is negative or not an integer.
     */
    public static factorial(n: number): number {
        return factorial(n)
    }

    /**
     * Compute the gamma function (Nemes' approximation): `gamma(n) = (n - 1)!` for the positive integers, extended to
     * the real numbers.
     * @param n The value. Zero and the negative integers give `NaN`; beyond about 171 the result is `Infinity`.
     * @returns The gamma of `n` (`gamma(0.5)` is `√π`, 1.7724538…), to about 10 significant digits.
     */
    public static gamma(n: number): number {
        return gamma(n)
    }

    /**
     * Tell whether a number is close to an expected one, by their relative difference: `|actual - expected| /
     * |expected|` at most `tolerance` (two zeros are equal; an expected `0` with any other value is not).
     * @param actual The number to check.
     * @param expected The expected number.
     * @param tolerance The largest relative difference (`0.01` is 1%). The type requires it; `undefined` gives
     * `epsilon`.
     * @returns `true` when the numbers are close enough.
     */
    public static approxEqual(actual: number, expected: number, tolerance: number): boolean {
        return approxEqual(actual, expected, tolerance)
    }

    /**
     * Find a root of a function (an `x` where it is 0) by bisection: the interval is halved, keeping the half where the
     * function changes sign, until it is small enough. The function should change sign between `start` and `end`; when
     * it does not, a bound is returned rather than an error.
     * @param func The function, of a number.
     * @param start The lower bound of the interval.
     * @param end The upper bound of the interval.
     * @param maxIterations The most halvings before giving up.
     * @param errorTolerance The half-width of the interval at which it stops.
     * @returns The approximate root.
     * @throws {Error} When the root is not found in `maxIterations` halvings (`maximum number of iterations exceeded`).
     */
    public static bisect(func: (x: any) => number, start: number, end: number, maxIterations: number, errorTolerance: number): number {
        return bisect(func, start, end, maxIterations, errorTolerance)
    }

    /**
     * Get the coefficient of variation of an array: its sample standard deviation divided by its mean, a spread without
     * unit to compare series of different scales.
     * @param x The numbers, at least two.
     * @returns The coefficient of variation; an infinity when the mean is `0`.
     * @throws {Error} When `x` has fewer than two numbers.
     */
    public static coefficientOfVariation(x: number[]): number {
        return coefficientOfVariation(x)
    }

    /**
     * List the combinations with replacement of `k` items of an array: the multisets of `k` items, an item possibly
     * repeated, regardless of order.
     * @param x The items to combine.
     * @param k The size of the combinations: `0` gives the single empty combination `[[]]`; a negative or fractional
     * size gives `[]`.
     * @returns The combinations, each an array of `k` items.
     */
    public static combinationsReplacement(x: number[], k: number): number[][] {
        return combinationsReplacement(x, k)
    }

    /**
     * List the combinations of `k` items of an array: its subsets of `k` items, regardless of order.
     * @param x The items to combine.
     * @param k The size of the combinations: `0` gives the single empty combination `[[]]`; more than the length of
     * `x`, a negative or fractional size gives `[]`.
     * @returns The combinations, each an array of `k` items.
     */
    public static combinations(x: number[], k: number): number[][] {
        return combinations(x, k)
    }

    /**
     * Get the mean of two lists merged, from their means and counts, without the lists.
     * @param mean1 The mean of the first list.
     * @param n1 The count of numbers of the first list.
     * @param mean2 The mean of the second list.
     * @param n2 The count of numbers of the second list.
     * @returns The mean of the `n1 + n2` numbers.
     */
    public static combineMeans(mean1: number, n1: number, mean2: number, n2: number): number {
        return combineMeans(mean1, n1, mean2, n2)
    }

    /**
     * Get the population variance of two lists merged, from their population variances, means and counts, without the
     * lists.
     * @param variance1 The population variance of the first list.
     * @param mean1 The mean of the first list.
     * @param n1 The count of numbers of the first list.
     * @param variance2 The population variance of the second list.
     * @param mean2 The mean of the second list.
     * @param n2 The count of numbers of the second list.
     * @returns The population variance of the `n1 + n2` numbers.
     */
    public static combineVariances(variance1: number, mean1: number, n1: number, variance2: number, mean2: number, n2: number): number {
        return combineVariances(variance1, mean1, n1, variance2, mean2, n2)
    }

    /**
     * Compute the cumulative distribution function of the standard logistic distribution: `1 / (1 + e^-x)`, the
     * sigmoid.
     * @param x The value.
     * @returns The probability, from 0 to 1 (`0.5` for `0`).
     * @see https://en.wikipedia.org/wiki/Logistic_distribution
     */
    public static cumulativeStdLogisticProbability(x: number): number {
        return cumulativeStdLogisticProbability(x)
    }

    /**
     * Get the smallest and the largest numbers of an array in one pass.
     * @param x The numbers.
     * @returns `[min, max]`.
     * @throws {Error} When `x` is empty.
     */
    public static extent(x: number[]): [number, number] {
        return extent(x)
    }

    /**
     * Compute the natural logarithm of the gamma function (Lanczos' approximation), for the values too large for
     * `gamma` (beyond 171).
     * @param n The value, positive; zero and the negative values give `Infinity`.
     * @returns `ln(gamma(n))`.
     */
    public static gammaln(n: number): number {
        return gammaln(n)
    }

    /**
     * Find the Jenks natural breaks of an array: the class bounds which minimize the variance within the classes, used
     * to group the values of a choropleth map or a histogram.
     * @param data The numbers (copied before they are sorted).
     * @param nClasses The count of classes, at most the length of `data`.
     * @returns The `nClasses + 1` bounds, from the smallest number to the largest; `null` when `nClasses` is greater
     * than the length of `data`.
     */
    public static jenks(data: number[], nClasses: number): number[] | null {
        return jenks(data, nClasses)
    }

    /**
     * Get the geometric mean of an array through the logarithms (the exponential of the mean logarithm), which avoids
     * the overflow of the product of large or many numbers.
     * @param x The numbers, none negative.
     * @returns The geometric mean.
     * @throws {Error} When `x` is empty, or a number is negative.
     */
    public static logAverage(x: number[]): number {
        return logAverage(x)
    }

    /**
     * Compute the logit of a probability: `ln(p / (1 - p))`, the inverse of `cumulativeStdLogisticProbability`.
     * @param p The probability, strictly between 0 and 1.
     * @returns The log-odds (`0` for `0.5`).
     * @throws {Error} When `p` is not strictly between 0 and 1.
     * @see https://en.wikipedia.org/wiki/Logit
     */
    public static logit(p: number): number {
        return logit(p)
    }

    /**
     * Compute the probit of a probability: the quantile of the standard normal distribution, the number of standard
     * deviations below which a fraction `p` of normal values fall (`probit(0.975)` is about `1.96`).
     * @param p The probability, from 0 to 1. It is not validated: `0` and the values from `1` up are clamped to
     * `epsilon` and `1 - epsilon` (giving about `-3.71` and `3.71`), and a negative value gives `NaN`.
     * @returns The quantile.
     */
    public static probit(p: number): number {
        return probit(p)
    }

    /**
     * Get the quantile rank of a value in an array: the fraction of the numbers below it, from 0 to 1 (the mean rank
     * when the value appears several times). The array is copied before it is sorted.
     * @param x The numbers; an empty array gives `NaN`.
     * @param value The value to rank: below all the numbers gives `0`, above all `1`.
     * @returns The quantile rank.
     */
    public static quantileRank(x: number[], value: number): number {
        return quantileRank(x, value)
    }

    /**
     * Partially sort a copy of an array so that its `k`-th item (from 0) is the one a full sort would put there, the
     * smaller items before it and the larger after it, in linear time on average (Floyd-Rivest). Faster than a sort to
     * get the k smallest numbers. The array given is not modified.
     * @param arr The numbers.
     * @param k The index to place, from 0.
     * @param left The first index of the range to partition; 0 by default.
     * @param right The last index of the range to partition; the last index of the array by default (`0` is taken as
     * the default too).
     * @returns The partially sorted copy.
     */
    public static quickselect(arr: number[], k: number, left?: number, right?: number): number[] {
        const _arr: number[] = [...arr]
        quickselect(_arr, k, left, right)
        return _arr
    }

    /**
     * Update a mean when a value is removed, without the list it was computed from: `(mean * n - value) / (n - 1)`.
     * @param mean The current mean.
     * @param n The count of numbers the mean was computed from; `1` gives `NaN`.
     * @param value The number removed.
     * @returns The mean of the `n - 1` numbers.
     */
    public static subtractFromMean(mean: number, n: number, value: number): number {
        return subtractFromMean(mean, n, value)
    }

    /**
     * Update a mean when a value is removed; the same as `subtractFromMean`.
     * @param mean The current mean.
     * @param n The count of numbers the mean was computed from; `1` gives `NaN`.
     * @param value The number removed.
     * @returns The mean of the `n - 1` numbers.
     */
    public static subtractFromAverage(mean: number, n: number, value: number): number {
        return subtractFromMean(mean, n, value)
    }
}