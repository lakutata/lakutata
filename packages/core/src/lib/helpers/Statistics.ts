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
} from 'simple-statistics'

export class Statistics {

    /**
     * We use ε, epsilon, as a stopping criterion when we want to iterate until we're "close enough". Epsilon is a very small number: for simple statistics, that number is 0.0001
     * This is used in calculations like the binomialDistribution, in which the process of finding a value is iterative: it progresses until it is close enough.
     */
    public static epsilon: number = epsilon

    /**
     * The min is the lowest number in the array. This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static min(x: number[]): number {
        return min(x)
    }

    /**
     * This computes the maximum number in an array.
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static max(x: number[]): number {
        return max(x)
    }

    /**
     * The sum of an array is the result of adding all numbers together
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static sum(x: number[]): number {
        return sum(x)
    }

    /**
     * This is an implementation of the Quantiles of a Population algorithm
     * Sample is a one-dimensional array of numbers, and p is either a decimal number from 0 to 1 or an array of decimal numbers from 0 to 1. In terms of a k/q quantile, p = k/q - it's just dealing with fractions or dealing with decimal values.
     * @param x
     * @param p
     */
    public static quantile(x: number[], p: number): number {
        return quantile(x, p)
    }

    /**
     * The product of an array is the result of multiplying all numbers together, starting using one as the multiplicative identity.
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static product(x: number[]): number {
        return product(x)
    }

    /**
     * The mean, also known as average, is the sum of all values over the number of values. This is a measure of central tendency: a method of finding a typical or central value of a set of numbers.
     * @param x
     */
    public static mean(x: number[]): number {
        return mean(x)
    }

    /**
     * The average, is the sum of all values over the number of values. This is a measure of central tendency: a method of finding a typical or central value of a set of numbers.
     * @param x
     */
    public static average(x: number[]): number {
        return average(x)
    }

    /**
     * When adding a new value to a list, one does not have to necessary recompute the mean of the list in linear time. They can instead use this function to compute the new mean by providing the current mean, the number of elements in the list that produced it and the new value to add.
     * @param mean
     * @param n
     * @param newValue
     */
    public static addToMean(mean: number, n: number, newValue: number): number {
        return addToMean(mean, n, newValue)
    }

    /**
     * When adding a new value to a list, one does not have to necessary recompute the mean of the list in linear time. They can instead use this function to compute the new mean by providing the current mean, the number of elements in the list that produced it and the new value to add.
     * @param average
     * @param n
     * @param newValue
     */
    public static addToAverage(average: number, n: number, newValue: number): number {
        return addToMean(average, n, newValue)
    }

    /**
     * The mode is the number that appears in a list the highest number of times. There can be multiple modes in a list: in the event of a tie, this algorithm will return the most recently seen mode.
     * This is a measure of central tendency: a method of finding a typical or central value of a set of numbers.
     * This runs in O(n log(n)) because it needs to sort the array internally before running an O(n) search to find the mode.
     * @param x
     */
    public static mode(x: number[]): number {
        return mode(x)
    }

    /**
     * The median is the middle number of a list. This is often a good indicator of 'the middle' when there are outliers that skew the mean() value. This is a measure of central tendency: a method of finding a typical or central value of a set of numbers.
     * The median isn't necessarily one of the elements in the list: the value can be the average of two elements if the list has an even length and the two central values are different.
     * @param x
     */
    public static median(x: number[]): number {
        return median(x)
    }

    /**
     * The Harmonic Mean is a mean function typically used to find the average of rates. This mean is calculated by taking the reciprocal of the arithmetic mean of the reciprocals of the input numbers.
     * This is a measure of central tendency: a method of finding a typical or central value of a set of numbers.
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static harmonicMean(x: number[]): number {
        return harmonicMean(x)
    }

    /**
     * The Geometric Mean is a mean function that is more useful for numbers in different ranges.
     * This is the nth root of the input numbers multiplied by each other.
     * The geometric mean is often useful for proportional growth: given growth rates for multiple years, like 80%, 16.66% and 42.85%, a simple mean will incorrectly estimate an average growth rate, whereas a geometric mean will correctly estimate a growth rate that, over those years, will yield the same end value.
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static geometricMean(x: number[]): number {
        return geometricMean(x)
    }

    /**
     * The Root Mean Square (RMS) is a mean function used as a measure of the magnitude of a set of numbers, regardless of their sign. This is the square root of the mean of the squares of the input numbers. This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static rootMeanSquare(x: number[]): number {
        return rootMeanSquare(x)
    }

    /**
     * Skewness is a measure of the extent to which a probability distribution of a real-valued random variable "leans" to one side of the mean. The skewness value can be positive or negative, or even undefined.
     * Implementation is based on the adjusted Fisher-Pearson standardized moment coefficient, which is the version found in Excel and several statistical packages including Minitab, SAS and SPSS.
     * @param x
     */
    public static sampleSkewness(x: number[]): number {
        return sampleSkewness(x)
    }

    /**
     * The variance is the sum of squared deviations from the mean.
     * This is an implementation of variance, not sample variance: see the sampleVariance method if you want a sample measure.
     * @param x
     */
    public static variance(x: number[]): number {
        return variance(x)
    }

    /**
     * The sample variance is the sum of squared deviations from the mean. The sample variance is distinguished from the variance by the usage of Bessel's Correction: instead of dividing the sum of squared deviations by the length of the input, it is divided by the length minus one. This corrects the bias in estimating a value from a set that you don't know if full.
     * @see http://mathworld.wolfram.com/SampleVariance.html
     * @param x
     */
    public static sampleVariance(x: number[]): number {
        return sampleVariance(x)
    }

    /**
     * The standard deviation is the square root of the variance. This is also known as the population standard deviation. It's useful for measuring the amount of variation or dispersion in a set of values.
     * Standard deviation is only appropriate for full-population knowledge: for samples of a population, sampleStandardDeviation is more appropriate.
     * @param x
     */
    public static standardDeviation(x: number[]): number {
        return standardDeviation(x)
    }

    /**
     * The sample standard deviation is the square root of the sample variance.
     * @param x
     */
    public static sampleStandardDeviation(x: number[]): number {
        return sampleStandardDeviation(x)
    }

    /**
     * The Median Absolute Deviation is a robust measure of statistical dispersion. It is more resilient to outliers than the standard deviation.
     * @param x
     */
    public static medianAbsoluteDeviation(x: number[]): number {
        return medianAbsoluteDeviation(x)
    }

    /**
     * The Interquartile range is a measure of statistical dispersion, or how scattered, spread, or concentrated a distribution is. It's computed as the difference between the third quartile and first quartile.
     * @param x
     */
    public static interquartileRange(x: number[]): number {
        return interquartileRange(x)
    }

    /**
     * The sum of deviations to the Nth power. When n=2 it's the sum of squared deviations. When n=3 it's the sum of cubed deviations.
     * @param x
     * @param n
     */
    public static sumNthPowerDeviations(x: number[], n: number): number {
        return sumNthPowerDeviations(x, n)
    }

    /**
     * The Z-Score, or Standard Score.
     * The standard score is the number of standard deviations an observation or datum is above or below the mean. Thus, a positive standard score represents a datum above the mean, while a negative standard score represents a datum below the mean. It is a dimensionless quantity obtained by subtracting the population mean from an individual raw score and then dividing the difference by the population standard deviation.
     * The z-score is only defined if one knows the population parameters; if one only has a sample set, then the analogous computation with sample mean and sample standard deviation yields the Student's t-statistic.
     * @param x
     * @param mean
     * @param standardDeviation
     */
    public static zScore(x: number, mean: number, standardDeviation: number): number {
        return zScore(x, mean, standardDeviation)
    }

    /**
     * The correlation is a measure of how correlated two datasets are, between -1 and 1
     * @param x
     * @param y
     */
    public static correlation(x: number[], y: number[]): number {
        return sampleCorrelation(x, y)
    }

    /**
     * Sample covariance of two datasets: how much do the two datasets move together? x and y are two datasets, represented as arrays of numbers.
     * @param x
     * @param y
     */
    public static sampleCovariance(x: number[], y: number[]): number {
        return sampleCovariance(x, y)
    }

    /**
     * The R Squared value of data compared with a function f is the sum of the squared differences between the prediction and the actual value.
     * @param data
     */
    public static rSquared(data: [number[], number[]]): number {
        return rSquared(data, this.linearRegressionLine(this.linearRegression(data)))
    }

    /**
     * Simple linear regression is a simple way to find a fitted line between a set of coordinates. This algorithm finds the slope and y-intercept of a regression line using the least sum of squares.
     * @param data
     */
    public static linearRegression(data: [number[], number[]]): { m: number, b: number } {
        return linearRegression(data)
    }

    /**
     * Given the output of linearRegression: an object with m and b values indicating slope and intercept, respectively, generate a line function that translates x values into y values.
     * @param mb
     */
    public static linearRegressionLine(mb: { m: number, b: number }): (x: number) => number {
        return linearRegressionLine(mb)
    }

    /**
     * A Fisher-Yates shuffle is a fast way to create a random permutation of a finite set. This is a function around shuffle_in_place that adds the guarantee that it will not modify its input.
     * @param x
     */
    public static shuffle(x: number[]): number[] {
        return shuffle(x)
    }

    /**
     * Sampling with replacement is a type of sampling that allows the same item to be picked out of a population more than once.
     * @param x
     * @param n
     */
    public static sampleWithReplacement(x: number[], n: number): number[] {
        return sampleWithReplacement(x, n)
    }

    /**
     * Create a simple random sample from a given array of n elements.
     * The sampled values will be in any order, not necessarily the order they appear in the input.
     * @param x
     * @param n
     */
    public static sample(x: number[], n: number): number[] {
        return sample(x, n, Math.random)
    }

    /**
     * Random pick an item from input
     * @param x
     */
    public static randomPickOne(x: number[]): number {
        return this.sample(x, 1)[0]
    }

    /**
     * Random pick items from input
     * @param x
     * @param n
     */
    public static randomPickMany(x: number[], n: number): number[] {
        return this.sample(x, n)
    }

    /**
     * The Bernoulli distribution is the probability discrete distribution of a random variable which takes value 1 with success probability p and value 0 with failure probability q = 1 - p. It can be used, for example, to represent the toss of a coin, where "1" is defined to mean "heads" and "0" is defined to mean "tails" (or vice versa). It is a special case of a Binomial Distribution where n = 1.
     * @param p
     */
    public static bernoulliDistribution(p: number): number[] {
        return bernoulliDistribution(p)
    }

    /**
     * The Binomial Distribution is the discrete probability distribution of the number of successes in a sequence of n independent yes/no experiments, each of which yields success with probability probability. Such a success/failure experiment is also called a Bernoulli experiment or Bernoulli trial; when trials = 1, the Binomial Distribution is a Bernoulli Distribution.
     * @param trials
     * @param probability
     */
    public static binomialDistribution(trials: number, probability: number): number[] {
        return binomialDistribution(trials, probability)
    }

    /**
     * The Poisson Distribution is a discrete probability distribution that expresses the probability of a given number of events occurring in a fixed interval of time and/or space if these events occur with a known average rate and independently of the time since the last event.
     * The Poisson Distribution is characterized by the strictly positive mean arrival or occurrence rate, λ.
     * @param lambda
     */
    public static poissonDistribution(lambda: number): number[] {
        return poissonDistribution(lambda)
    }

    /**
     * This is to compute a one-sample t-test, comparing the mean of a sample to a known value, x.
     * in this case, we're trying to determine whether the population mean is equal to the value that we know, which is x here. Usually the results here are used to look up a p-value, which, for a certain level of significance, will let you determine that the null hypothesis can or cannot be rejected.
     * @param x
     * @param expectedValue
     */
    public static tTest(x: number[], expectedValue: number): number {
        return tTest(x, expectedValue)
    }

    /**
     * This is to compute two sample t-test. Tests whether "mean(X)-mean(Y) = difference", ( in the most common case, we often have difference == 0 to test if two samples are likely to be taken from populations with the same mean value) with no prior knowledge on standard deviations of both samples other than the fact that they have the same standard deviation.
     * Usually the results here are used to look up a p-value, which, for a certain level of significance, will let you determine that the null hypothesis can or cannot be rejected.
     * diff can be omitted if it equals 0.
     * This is used to reject a null hypothesis that the two populations that have been sampled into sampleX and sampleY are equal to each other.
     * @param sampleX
     * @param sampleY
     * @param difference
     */
    public static tTestTwoSample(sampleX: number[], sampleY: number[], difference: number = 0): number | null {
        return tTestTwoSample(sampleX, sampleY, difference)
    }

    /**
     * Split an array into chunks of a specified size. This function has the same behavior as PHP's array_chunk function, and thus will insert smaller-sized chunks at the end if the input size is not divisible by the chunk size.
     * x is expected to be an array, and chunkSize a number. The x array can contain any kind of data.
     * @param x
     * @param chunkSize
     */
    public static chunk(x: number[], chunkSize: number): number[][] {
        return chunk(x, chunkSize)
    }

    /**
     * A Factorial, usually written n!, is the product of all positive integers less than or equal to n. Often factorial is implemented recursively, but this iterative approach is significantly faster and simpler.
     * @param n
     */
    public static factorial(n: number): number {
        return factorial(n)
    }

    /**
     * Compute the gamma function of a value using Nemes' approximation. The gamma of n is equivalent to (n-1)!, but unlike the factorial function, gamma is defined for all real n except zero and negative integers (where NaN is returned). Note, the gamma function is also well-defined for complex numbers, though this implementation currently does not handle complex numbers as input values.
     * @param n
     */
    public static gamma(n: number): number {
        return gamma(n)
    }

    /**
     * Approximate equality.
     * @param actual
     * @param expected
     * @param tolerance
     */
    public static approxEqual(actual: number, expected: number, tolerance: number): boolean {
        return approxEqual(actual, expected, tolerance)
    }

    /**
     * Bisection method is a root-finding method that repeatedly bisects an interval to find the root.
     * This function returns a numerical approximation to the exact value.
     * @param func
     * @param start
     * @param end
     * @param maxIterations
     * @param errorTolerance
     */
    public static bisect(func: (x: any) => number, start: number, end: number, maxIterations: number, errorTolerance: number): number {
        return bisect(func, start, end, maxIterations, errorTolerance)
    }

    /**
     * Thecoefficient of variation_ is the ratio of the standard deviation to the mean. .._coefficient of variation: https://en.wikipedia.org/wiki/Coefficient_of_variation
     * @param x
     */
    public static coefficientOfVariation(x: number[]): number {
        return coefficientOfVariation(x)
    }

    /**
     * Implementation of Combinations with replacement Combinations are unique subsets of a collection - in this case, k x from a collection at a time. 'With replacement' means that a given element can be chosen multiple times. Unlike permutation, order doesn't matter for combinations.
     * @param x
     * @param k
     */
    public static combinationsReplacement(x: number[], k: number): number[][] {
        return combinationsReplacement(x, k)
    }

    /**
     * Implementation of Combinations Combinations are unique subsets of a collection - in this case, k x from a collection at a time. https://en.wikipedia.org/wiki/Combination
     * @param x
     * @param k
     */
    public static combinations(x: number[], k: number): number[][] {
        return combinations(x, k)
    }

    /**
     * When combining two lists of values for which one already knows the means, one does not have to necessary recompute the mean of the combined lists in linear time. They can instead use this function to compute the combined mean by providing the mean & number of values of the first list and the mean & number of values of the second list.
     * @param mean1
     * @param n1
     * @param mean2
     * @param n2
     */
    public static combineMeans(mean1: number, n1: number, mean2: number, n2: number): number {
        return combineMeans(mean1, n1, mean2, n2)
    }

    /**
     * When combining two lists of values for which one already knows the variances, one does not have to necessary recompute the variance of the combined lists in linear time. They can instead use this function to compute the combined variance by providing the variance, mean & number of values of the first list and the variance, mean & number of values of the second list.
     * @param variance1
     * @param mean1
     * @param n1
     * @param variance2
     * @param mean2
     * @param n2
     */
    public static combineVariances(variance1: number, mean1: number, n1: number, variance2: number, mean2: number, n2: number): number {
        return combineVariances(variance1, mean1, n1, variance2, mean2, n2)
    }

    /**
     * Logistic Cumulative Distribution Function
     * @see https://en.wikipedia.org/wiki/Logistic_distribution
     * @param x
     */
    public static cumulativeStdLogisticProbability(x: number): number {
        return cumulativeStdLogisticProbability(x)
    }

    /**
     * This computes the minimum & maximum number in an array.
     * This runs in O(n), linear time, with respect to the length of the array.
     * @param x
     */
    public static extent(x: number[]): [number, number] {
        return extent(x)
    }

    /**
     * Compute the logarithm of the gamma function of a value using Lanczos' approximation. This function takes as input any real-value n greater than 0. This function is useful for values of n too large for the normal gamma function (n > 165).
     * @param n
     */
    public static gammaln(n: number): number {
        return gammaln(n)
    }

    /**
     * The jenks natural breaks optimization is an algorithm commonly used in cartography and visualization to decide upon groupings of data values that minimize variance within themselves and maximize variation between themselves.
     * @param data
     * @param nClasses
     */
    public static jenks(data: number[], nClasses: number): number[] {
        return jenks(data, nClasses)
    }

    /**
     * The log average is an equivalent way of computing the geometric mean of an array suitable for large or small products.
     * It's found by calculating the average logarithm of the elements and exponentiating.
     * @param x
     */
    public static logAverage(x: number[]): number {
        return logAverage(x)
    }

    /**
     * The Logit is the inverse of cumulativeStdLogisticProbability, and is also known as the logistic quantile function.
     * @see https://en.wikipedia.org/wiki/Logit
     * @param p
     */
    public static logit(p: number): number {
        return logit(p)
    }

    /**
     * The Probit is the inverse of cumulativeStdNormalProbability(), and is also known as the normal quantile function.
     * It returns the number of standard deviations from the mean where the p'th quantile of values can be found in a normal distribution. So, for example, probit(0.5 + 0.6827/2) ≈ 1 because 68.27% of values are normally found within 1 standard deviation above or below the mean.
     * @param p
     */
    public static probit(p: number): number {
        return probit(p)
    }

    /**
     * This function returns the quantile in which one would find the given value in the given array. It will copy and sort your array before each run.
     * @param x
     * @param value
     */
    public static quantileRank(x: number[], value: number): number {
        return quantileRank(x, value)
    }

    /**
     * Rearrange items in arr so that all items in [left, k] range are the smallest. The k-th element will have the (k - left + 1)-th smallest value in [left, right].
     * @param arr
     * @param k
     * @param left
     * @param right
     */
    public static quickselect(arr: number[], k: number, left?: number, right?: number): number[] {
        const _arr: number[] = [...arr]
        quickselect(_arr, k, left, right)
        return _arr
    }

    /**
     * When removing a value from a list, one does not have to necessary recompute the mean of the list in linear time. They can instead use this function to compute the new mean by providing the current mean, the number of elements in the list that produced it and the value to remove.
     * @param mean
     * @param n
     * @param value
     */
    public static subtractFromMean(mean: number, n: number, value: number): number {
        return subtractFromMean(mean, n, value)
    }

    /**
     * When removing a value from a list, one does not have to necessary recompute the mean of the list in linear time. They can instead use this function to compute the new mean by providing the current mean, the number of elements in the list that produced it and the value to remove.
     * @param mean
     * @param n
     * @param value
     */
    public static subtractFromAverage(mean: number, n: number, value: number): number {
        return subtractFromMean(mean, n, value)
    }
}