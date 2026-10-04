import {type LinearRegression} from '../../../types/LinearRegression.js'

/**
 * Derived from src of simple-statistics 7.8.8 (ISC, see THIRD_PARTY_NOTICES.md): the functions used by Statistics, the
 * gamma below 10 and the combinations of 0 items fixed
 */

/**
 * The stopping criterion of the iterative calculations ("close enough")
 */
export const epsilon: number = 0.0001

/**
 * The sign of a number
 * @param x
 */
export function sign(x: number): number {
    if (typeof x !== 'number') throw new TypeError('not a number')
    return x < 0 ? -1 : x === 0 ? 0 : 1
}

/**
 * A sorted copy of numbers
 * @param x
 */
export function numericSort(x: number[]): number[] {
    return x.slice().sort((a: number, b: number): number => a - b)
}

/**
 * The sum of numbers, with the Kahan-Babuska compensation of the rounding errors
 * @param x
 */
export function sum(x: number[]): number {
    if (x.length === 0) return 0
    let total: number = x[0]
    let correction: number = 0
    if (typeof total !== 'number') return Number.NaN
    for (let i: number = 1; i < x.length; i++) {
        if (typeof x[i] !== 'number') return Number.NaN
        const transition: number = total + x[i]
        if (Math.abs(total) >= Math.abs(x[i])) {
            correction += total - transition + x[i]
        } else {
            correction += x[i] - transition + total
        }
        total = transition
    }
    return total + correction
}

export function mean(x: number[]): number {
    if (x.length === 0) throw new Error('mean requires at least one data point')
    return sum(x) / x.length
}

export const average: (x: number[]) => number = mean

export function min(x: number[]): number {
    if (x.length === 0) throw new Error('min requires at least one data point')
    let value: number = x[0]
    for (let i: number = 1; i < x.length; i++) if (x[i] < value) value = x[i]
    return value
}

export function max(x: number[]): number {
    if (x.length === 0) throw new Error('max requires at least one data point')
    let value: number = x[0]
    for (let i: number = 1; i < x.length; i++) if (x[i] > value) value = x[i]
    return value
}

export function product(x: number[]): number {
    let value: number = 1
    for (let i: number = 0; i < x.length; i++) value *= x[i]
    return value
}

export function extent(x: number[]): [number, number] {
    if (x.length === 0) throw new Error('extent requires at least one data point')
    let low: number = x[0]
    let high: number = x[0]
    for (let i: number = 1; i < x.length; i++) {
        if (x[i] > high) high = x[i]
        if (x[i] < low) low = x[i]
    }
    return [low, high]
}

export function addToMean(meanValue: number, n: number, newValue: number): number {
    return meanValue + (newValue - meanValue) / (n + 1)
}

export function subtractFromMean(meanValue: number, n: number, value: number): number {
    return (meanValue * n - value) / (n - 1)
}

export function combineMeans(mean1: number, n1: number, mean2: number, n2: number): number {
    return (mean1 * n1 + mean2 * n2) / (n1 + n2)
}

export function combineVariances(variance1: number, mean1: number, n1: number, variance2: number, mean2: number, n2: number): number {
    const newMean: number = combineMeans(mean1, n1, mean2, n2)
    return (n1 * (variance1 + Math.pow(mean1 - newMean, 2)) + n2 * (variance2 + Math.pow(mean2 - newMean, 2))) / (n1 + n2)
}

export function sumNthPowerDeviations(x: number[], n: number): number {
    const meanValue: number = mean(x)
    let total: number = 0
    if (n === 2) {
        for (let i: number = 0; i < x.length; i++) {
            const deviation: number = x[i] - meanValue
            total += deviation * deviation
        }
    } else {
        for (let i: number = 0; i < x.length; i++) total += Math.pow(x[i] - meanValue, n)
    }
    return total
}

export function variance(x: number[]): number {
    if (x.length === 0) throw new Error('variance requires at least one data point')
    return sumNthPowerDeviations(x, 2) / x.length
}

export function standardDeviation(x: number[]): number {
    if (x.length === 1) return 0
    return Math.sqrt(variance(x))
}

export function sampleVariance(x: number[]): number {
    if (x.length < 2) throw new Error('sampleVariance requires at least two data points')
    //Bessel's correction
    return sumNthPowerDeviations(x, 2) / (x.length - 1)
}

export function sampleStandardDeviation(x: number[]): number {
    return Math.sqrt(sampleVariance(x))
}

export function sampleCovariance(x: number[], y: number[]): number {
    if (x.length !== y.length) throw new Error('sampleCovariance requires samples with equal lengths')
    if (x.length < 2) throw new Error('sampleCovariance requires at least two data points in each sample')
    const xMean: number = mean(x)
    const yMean: number = mean(y)
    let total: number = 0
    for (let i: number = 0; i < x.length; i++) total += (x[i] - xMean) * (y[i] - yMean)
    return total / (x.length - 1)
}

export function sampleCorrelation(x: number[], y: number[]): number {
    return sampleCovariance(x, y) / sampleStandardDeviation(x) / sampleStandardDeviation(y)
}

export function sampleSkewness(x: number[]): number {
    if (x.length < 3) throw new Error('sampleSkewness requires at least three data points')
    const meanValue: number = mean(x)
    let sumSquaredDeviations: number = 0
    let sumCubedDeviations: number = 0
    for (let i: number = 0; i < x.length; i++) {
        const deviation: number = x[i] - meanValue
        sumSquaredDeviations += deviation * deviation
        sumCubedDeviations += deviation * deviation * deviation
    }
    const theSampleStandardDeviation: number = Math.sqrt(sumSquaredDeviations / (x.length - 1))
    const n: number = x.length
    return (n * sumCubedDeviations) / ((n - 1) * (n - 2) * Math.pow(theSampleStandardDeviation, 3))
}

/**
 * Swap two items of an array
 * @param array
 * @param i
 * @param j
 */
function swap(array: number[], i: number, j: number): void {
    const item: number = array[i]
    array[i] = array[j]
    array[j] = item
}

/**
 * Rearrange an array so that its k-th item is the one of the sorted array, the smaller ones before it and the larger
 * ones after it (Floyd-Rivest)
 * @param array
 * @param k
 * @param left
 * @param right
 */
export function quickselect(array: number[], k: number, left?: number, right?: number): void {
    left = left || 0
    right = right || array.length - 1
    while (right > left) {
        //600 and 0.5 are the constants of the original algorithm
        if (right - left > 600) {
            const n: number = right - left + 1
            const m: number = k - left + 1
            const z: number = Math.log(n)
            const s: number = 0.5 * Math.exp((2 * z) / 3)
            let sd: number = 0.5 * Math.sqrt((z * s * (n - s)) / n)
            if (m - n / 2 < 0) sd *= -1
            const newLeft: number = Math.max(left, Math.floor(k - (m * s) / n + sd))
            const newRight: number = Math.min(right, Math.floor(k + ((n - m) * s) / n + sd))
            quickselect(array, k, newLeft, newRight)
        }
        const t: number = array[k]
        let i: number = left
        let j: number = right
        swap(array, left, k)
        if (array[right] > t) swap(array, left, right)
        while (i < j) {
            swap(array, i, j)
            i++
            j--
            while (array[i] < t) i++
            while (array[j] > t) j--
        }
        if (array[left] === t) {
            swap(array, left, j)
        } else {
            j++
            swap(array, j, right)
        }
        if (j <= k) left = j + 1
        if (k <= j) right = j - 1
    }
}

export function quantileSorted(x: number[], p: number): number {
    const idx: number = x.length * p
    if (x.length === 0) throw new Error('quantile requires at least one data point.')
    if (p < 0 || p > 1) throw new Error('quantiles must be between 0 and 1')
    if (p === 1) return x[x.length - 1]
    if (p === 0) return x[0]
    if (idx % 1 !== 0) return x[Math.ceil(idx) - 1]
    if (x.length % 2 === 0) return (x[idx - 1] + x[idx]) / 2
    return x[idx]
}

/**
 * The index of a quantile in the sorted array
 * @param length
 * @param p
 */
function quantileIndex(length: number, p: number): number {
    const idx: number = length * p
    if (p === 1) return length - 1
    if (p === 0) return 0
    if (idx % 1 !== 0) return Math.ceil(idx) - 1
    if (length % 2 === 0) return idx - 0.5
    return idx
}

/**
 * Select the items of a quantile (two items for an index between two items)
 * @param array
 * @param k
 * @param left
 * @param right
 */
function quantileSelect(array: number[], k: number, left: number, right: number): void {
    if (k % 1 === 0) {
        quickselect(array, k, left, right)
    } else {
        k = Math.floor(k)
        quickselect(array, k, left, right)
        quickselect(array, k + 1, k + 1, right)
    }
}

/**
 * Select the items of several quantiles
 * @param array
 * @param p
 */
function multiQuantileSelect(array: number[], p: number[]): void {
    const indices: number[] = [0]
    for (let i: number = 0; i < p.length; i++) indices.push(quantileIndex(array.length, p[i]))
    indices.push(array.length - 1)
    indices.sort((a: number, b: number): number => a - b)
    const stack: number[] = [0, indices.length - 1]
    while (stack.length) {
        const r: number = Math.ceil(stack.pop()!)
        const l: number = Math.floor(stack.pop()!)
        if (r - l <= 1) continue
        const m: number = Math.floor((l + r) / 2)
        quantileSelect(array, indices[m], Math.floor(indices[l]), Math.ceil(indices[r]))
        stack.push(l, m, m, r)
    }
}

export function quantile(x: number[], p: number): number
export function quantile(x: number[], p: number[]): number[]
export function quantile(x: number[], p: number | number[]): number | number[] {
    const copy: number[] = x.slice()
    if (Array.isArray(p)) {
        multiQuantileSelect(copy, p)
        return p.map((value: number): number => quantileSorted(copy, value))
    }
    quantileSelect(copy, quantileIndex(copy.length, p), 0, copy.length - 1)
    return quantileSorted(copy, p)
}

/**
 * The first index of an item of a sorted array not lower than a value
 * @param x
 * @param value
 */
function lowerBound(x: number[], value: number): number {
    let lo: number = 0
    let hi: number = x.length
    while (lo < hi) {
        const mid: number = (lo + hi) >>> 1
        if (value <= x[mid]) {
            hi = mid
        } else {
            lo = -~mid
        }
    }
    return lo
}

/**
 * The first index of an item of a sorted array greater than a value
 * @param x
 * @param value
 */
function upperBound(x: number[], value: number): number {
    let lo: number = 0
    let hi: number = x.length
    while (lo < hi) {
        const mid: number = (lo + hi) >>> 1
        if (value >= x[mid]) {
            lo = -~mid
        } else {
            hi = mid
        }
    }
    return lo
}

export function quantileRankSorted(x: number[], value: number): number {
    if (value < x[0]) return 0
    if (value > x[x.length - 1]) return 1
    let l: number = lowerBound(x, value)
    if (x[l] !== value) return l / x.length
    l++
    const u: number = upperBound(x, value)
    if (u === l) return l / x.length
    //The mean rank of the equal items
    const r: number = u - l + 1
    return ((r * (u + l)) / 2 / r) / x.length
}

export function quantileRank(x: number[], value: number): number {
    return quantileRankSorted(numericSort(x), value)
}

export function median(x: number[]): number {
    return +quantile(x, 0.5)
}

export function modeSorted(sorted: number[]): number {
    if (sorted.length === 0) throw new Error('mode requires at least one data point')
    if (sorted.length === 1) return sorted[0]
    let last: number = sorted[0]
    let value: number = Number.NaN
    let maxSeen: number = 0
    let seenThis: number = 1
    for (let i: number = 1; i < sorted.length + 1; i++) {
        if (sorted[i] !== last) {
            if (seenThis > maxSeen) {
                maxSeen = seenThis
                value = last
            }
            seenThis = 1
            last = sorted[i]
        } else {
            seenThis++
        }
    }
    return value
}

export function mode(x: number[]): number {
    return modeSorted(numericSort(x))
}

export function harmonicMean(x: number[]): number {
    if (x.length === 0) throw new Error('harmonicMean requires at least one data point')
    let reciprocalSum: number = 0
    for (let i: number = 0; i < x.length; i++) {
        if (x[i] <= 0) throw new Error('harmonicMean requires only positive numbers as input')
        reciprocalSum += 1 / x[i]
    }
    return x.length / reciprocalSum
}

export function geometricMean(x: number[]): number {
    if (x.length === 0) throw new Error('geometricMean requires at least one data point')
    let value: number = 1
    for (let i: number = 0; i < x.length; i++) {
        if (x[i] < 0) throw new Error('geometricMean requires only non-negative numbers as input')
        value *= x[i]
    }
    return Math.pow(value, 1 / x.length)
}

export function logAverage(x: number[]): number {
    if (x.length === 0) throw new Error('logAverage requires at least one data point')
    let value: number = 0
    for (let i: number = 0; i < x.length; i++) {
        if (x[i] < 0) throw new Error('logAverage requires only non-negative numbers as input')
        value += Math.log(x[i])
    }
    return Math.exp(value / x.length)
}

export function rootMeanSquare(x: number[]): number {
    if (x.length === 0) throw new Error('rootMeanSquare requires at least one data point')
    let sumOfSquares: number = 0
    for (let i: number = 0; i < x.length; i++) sumOfSquares += Math.pow(x[i], 2)
    return Math.sqrt(sumOfSquares / x.length)
}

export function medianAbsoluteDeviation(x: number[]): number {
    const medianValue: number = median(x)
    const deviations: number[] = []
    for (let i: number = 0; i < x.length; i++) deviations.push(Math.abs(x[i] - medianValue))
    return median(deviations)
}

export function interquartileRange(x: number[]): number {
    //The quantiles of the numbers are numbers (the upstream checks their types)
    return quantile(x, 0.75) - quantile(x, 0.25)
}

export function coefficientOfVariation(x: number[]): number {
    return sampleStandardDeviation(x) / mean(x)
}

export function zScore(x: number, meanValue: number, standardDeviationValue: number): number {
    return (x - meanValue) / standardDeviationValue
}

/**
 * The relative error of a value
 * @param actual
 * @param expected
 */
function relativeError(actual: number, expected: number): number {
    if (actual === 0 && expected === 0) return 0
    return Math.abs((actual - expected) / expected)
}

export function approxEqual(actual: number, expected: number, tolerance: number = epsilon): boolean {
    return relativeError(actual, expected) <= tolerance
}

export function linearRegression(data: number[][]): LinearRegression {
    let m: number
    let b: number
    const dataLength: number = data.length
    if (dataLength === 1) {
        m = 0
        b = data[0][1]
    } else {
        let sumX: number = 0
        let sumY: number = 0
        let sumXX: number = 0
        let sumXY: number = 0
        for (let i: number = 0; i < dataLength; i++) {
            const x: number = data[i][0]
            const y: number = data[i][1]
            sumX += x
            sumY += y
            sumXX += x * x
            sumXY += x * y
        }
        m = (dataLength * sumXY - sumX * sumY) / (dataLength * sumXX - sumX * sumX)
        b = sumY / dataLength - (m * sumX) / dataLength
    }
    return {m: m, b: b}
}

export function linearRegressionLine(mb: LinearRegression): (x: number) => number {
    return (x: number): number => mb.b + mb.m * x
}

export function rSquared(x: number[][], func: (x: number) => number): number {
    if (x.length < 2) return 1
    let total: number = 0
    for (let i: number = 0; i < x.length; i++) total += x[i][1]
    const average: number = total / x.length
    let sumOfSquares: number = 0
    for (let j: number = 0; j < x.length; j++) sumOfSquares += Math.pow(average - x[j][1], 2)
    let error: number = 0
    for (let k: number = 0; k < x.length; k++) error += Math.pow(x[k][1] - func(x[k][0]), 2)
    return 1 - error / sumOfSquares
}

export function shuffleInPlace<T>(x: T[], randomSource?: () => number): T[] {
    const random: () => number = randomSource || Math.random
    let length: number = x.length
    while (length > 0) {
        const index: number = Math.floor(random() * length--)
        const item: T = x[length]
        x[length] = x[index]
        x[index] = item
    }
    return x
}

export function shuffle<T>(x: T[], randomSource?: () => number): T[] {
    return shuffleInPlace(x.slice(), randomSource)
}

export function sampleWithReplacement<T>(x: T[], n: number, randomSource?: () => number): T[] {
    if (x.length === 0) return []
    const random: () => number = randomSource || Math.random
    const sampled: T[] = []
    for (let i: number = 0; i < n; i++) sampled.push(x[Math.floor(random() * x.length)])
    return sampled
}

export function sample<T>(x: T[], n: number, randomSource?: () => number): T[] {
    return shuffle(x, randomSource).slice(0, n)
}

export function bernoulliDistribution(p: number): number[] {
    if (p < 0 || p > 1) throw new Error('bernoulliDistribution requires probability to be between 0 and 1 inclusive')
    return [1 - p, p]
}

export function binomialDistribution(trials: number, probability: number): number[] | undefined {
    if (probability < 0 || probability > 1 || trials <= 0 || trials % 1 !== 0) return undefined
    let x: number = 0
    let cumulativeProbability: number = 0
    const cells: number[] = []
    let binomialCoefficient: number = 1
    do {
        cells[x] = binomialCoefficient * Math.pow(probability, x) * Math.pow(1 - probability, trials - x)
        cumulativeProbability += cells[x]
        x++
        binomialCoefficient = (binomialCoefficient * (trials - x + 1)) / x
    } while (cumulativeProbability < 1 - epsilon)
    return cells
}

export function poissonDistribution(lambda: number): number[] | undefined {
    if (lambda <= 0) return undefined
    let x: number = 0
    let cumulativeProbability: number = 0
    const cells: number[] = []
    let factorialX: number = 1
    do {
        cells[x] = (Math.exp(-lambda) * Math.pow(lambda, x)) / factorialX
        cumulativeProbability += cells[x]
        x++
        factorialX *= x
    } while (cumulativeProbability < 1 - epsilon)
    return cells
}

export function tTest(x: number[], expectedValue: number): number {
    return (mean(x) - expectedValue) / (standardDeviation(x) / Math.sqrt(x.length))
}

export function tTestTwoSample(sampleX: number[], sampleY: number[], difference?: number): number | null {
    const n: number = sampleX.length
    const m: number = sampleY.length
    if (!n || !m) return null
    if (!difference) difference = 0
    const meanX: number = mean(sampleX)
    const meanY: number = mean(sampleY)
    const sampleVarianceX: number = sampleVariance(sampleX)
    const sampleVarianceY: number = sampleVariance(sampleY)
    //The means and the variances of the numbers are numbers (the upstream checks their types)
    const weightedVariance: number = ((n - 1) * sampleVarianceX + (m - 1) * sampleVarianceY) / (n + m - 2)
    return (meanX - meanY - difference) / Math.sqrt(weightedVariance * (1 / n + 1 / m))
}

export function chunk<T>(x: T[], chunkSize: number): T[][] {
    const output: T[][] = []
    if (chunkSize < 1) throw new Error('chunk size must be a positive number')
    if (Math.floor(chunkSize) !== chunkSize) throw new Error('chunk size must be an integer')
    for (let start: number = 0; start < x.length; start += chunkSize) output.push(x.slice(start, start + chunkSize))
    return output
}

export function factorial(n: number): number {
    if (n < 0) throw new Error('factorial requires a non-negative value')
    if (Math.floor(n) !== n) throw new Error('factorial requires an integer input')
    let accumulator: number = 1
    for (let i: number = 2; i <= n; i++) accumulator *= i
    return accumulator
}

export function gamma(n: number): number {
    if (Number.isInteger(n)) return n <= 0 ? Number.NaN : factorial(n - 1)
    //The recurrence upward, gamma(n) = gamma(n + k) / (n (n + 1) … (n + k - 1)), up to 10 where the approximation is
    //precise (the upstream approximates directly, 27% off at 1.1, and between 0 and 1 its reflection below calls
    //gamma(1 - n), between 0 and 1 too, until the stack overflows)
    if (n > 0 && n < 10) {
        let product: number = 1
        let shifted: number = n
        while (shifted < 10) product *= shifted++
        return gamma(shifted) / product
    }
    n--
    //Reflection formula for the negative numbers
    if (n < 0) return Math.PI / (Math.sin(Math.PI * -n) * gamma(-n))
    //Nemes' approximation
    const seriesCoefficient: number = Math.pow(n / Math.E, n) * Math.sqrt(2 * Math.PI * (n + 1 / 6))
    const seriesDenom: number = n + 1 / 4
    const seriesExpansion: number = 1 +
        1 / 144 / Math.pow(seriesDenom, 2) -
        1 / 12960 / Math.pow(seriesDenom, 3) -
        257 / 207360 / Math.pow(seriesDenom, 4) -
        52 / 2612736 / Math.pow(seriesDenom, 5) +
        5741173 / 9405849600 / Math.pow(seriesDenom, 6) +
        37529 / 18811699200 / Math.pow(seriesDenom, 7)
    return seriesCoefficient * seriesExpansion
}

//The coefficients as simple-statistics publishes them, with more digits than a number keeps
/* eslint-disable no-loss-of-precision */
const GAMMALN_COEFFICIENTS: number[] = [
    0.99999999999999709182, 57.156235665862923517, -59.597960355475491248,
    14.136097974741747174, -0.49191381609762019978, 0.33994649984811888699e-4,
    0.46523628927048575665e-4, -0.98374475304879564677e-4,
    0.15808870322491248884e-3, -0.21026444172410488319e-3,
    0.2174396181152126432e-3, -0.16431810653676389022e-3,
    0.84418223983852743293e-4, -0.2619083840158140867e-4,
    0.36899182659531622704e-5
]
/* eslint-enable no-loss-of-precision */

const GAMMALN_G: number = 607 / 128

const LOG_SQRT_2PI: number = Math.log(Math.sqrt(2 * Math.PI))

export function gammaln(n: number): number {
    if (n <= 0) return Number.POSITIVE_INFINITY
    n--
    let a: number = GAMMALN_COEFFICIENTS[0]
    for (let i: number = 1; i < 15; i++) a += GAMMALN_COEFFICIENTS[i] / (n + i)
    const tmp: number = GAMMALN_G + 0.5 + n
    return LOG_SQRT_2PI + Math.log(a) - tmp + (n + 0.5) * Math.log(tmp)
}

export function bisect(func: (x: any) => number, start: number, end: number, maxIterations: number, errorTolerance: number): number {
    if (typeof func !== 'function') throw new TypeError('func must be a function')
    for (let i: number = 0; i < maxIterations; i++) {
        const output: number = (start + end) / 2
        if (func(output) === 0 || Math.abs((end - start) / 2) < errorTolerance) return output
        if (sign(func(output)) === sign(func(start))) {
            start = output
        } else {
            end = output
        }
    }
    throw new Error('maximum number of iterations exceeded')
}

export function combinations<T>(x: T[], k: number): T[][] {
    //The single empty combination (the upstream gives none)
    if (k === 0) return [[]]
    const combinationList: T[][] = []
    for (let i: number = 0; i < x.length; i++) {
        if (k === 1) {
            combinationList.push([x[i]])
        } else {
            const subsetCombinations: T[][] = combinations(x.slice(i + 1, x.length), k - 1)
            for (const next of subsetCombinations) {
                next.unshift(x[i])
                combinationList.push(next)
            }
        }
    }
    return combinationList
}

export function combinationsReplacement<T>(x: T[], k: number): T[][] {
    //The single empty combination (the upstream recurses until the stack overflows)
    if (k === 0) return [[]]
    //A size which never reaches 1 would recurse without end
    if (!Number.isInteger(k) || k < 0) return []
    const combinationList: T[][] = []
    for (let i: number = 0; i < x.length; i++) {
        if (k === 1) {
            combinationList.push([x[i]])
        } else {
            const subsetCombinations: T[][] = combinationsReplacement(x.slice(i, x.length), k - 1)
            for (let j: number = 0; j < subsetCombinations.length; j++) combinationList.push([x[i]].concat(subsetCombinations[j]))
        }
    }
    return combinationList
}

export function cumulativeStdLogisticProbability(x: number): number {
    return 1 / (Math.exp(-x) + 1)
}

/**
 * The inverse of the error function (approximation)
 * @param x
 */
function inverseErrorFunction(x: number): number {
    const a: number = (8 * (Math.PI - 3)) / (3 * Math.PI * (4 - Math.PI))
    const inv: number = Math.sqrt(Math.sqrt(Math.pow(2 / (Math.PI * a) + Math.log(1 - x * x) / 2, 2) - Math.log(1 - x * x) / a) - (2 / (Math.PI * a) + Math.log(1 - x * x) / 2))
    return x >= 0 ? inv : -inv
}

export function probit(p: number): number {
    if (p === 0) {
        p = epsilon
    } else if (p >= 1) {
        p = 1 - epsilon
    }
    return Math.sqrt(2) * inverseErrorFunction(2 * p - 1)
}

export function logit(p: number): number {
    if (p <= 0 || p >= 1) throw new Error('p must be strictly between zero and one')
    return Math.log(p / (1 - p))
}

/**
 * The matrices of the Jenks natural breaks: the lower class limits and the variance combinations
 * @param data sorted
 * @param nClasses
 */
function jenksMatrices(data: number[], nClasses: number): { lowerClassLimits: number[][], varianceCombinations: number[][] } {
    const lowerClassLimits: number[][] = []
    const varianceCombinations: number[][] = []
    let currentVariance: number = 0
    for (let i: number = 0; i < data.length + 1; i++) {
        lowerClassLimits.push(new Array(nClasses + 1).fill(0))
        varianceCombinations.push(new Array(nClasses + 1).fill(0))
    }
    for (let i: number = 1; i < nClasses + 1; i++) {
        lowerClassLimits[1][i] = 1
        varianceCombinations[1][i] = 0
        for (let j: number = 2; j < data.length + 1; j++) varianceCombinations[j][i] = Number.POSITIVE_INFINITY
    }
    for (let l: number = 2; l < data.length + 1; l++) {
        let total: number = 0
        let sumSquares: number = 0
        let w: number = 0
        for (let m: number = 1; m < l + 1; m++) {
            const lowerClassLimit: number = l - m + 1
            const value: number = data[lowerClassLimit - 1]
            w++
            total += value
            sumSquares += value * value
            currentVariance = sumSquares - (total * total) / w
            const i4: number = lowerClassLimit - 1
            if (i4 !== 0) {
                for (let j: number = 2; j < nClasses + 1; j++) {
                    if (varianceCombinations[l][j] >= currentVariance + varianceCombinations[i4][j - 1]) {
                        lowerClassLimits[l][j] = lowerClassLimit
                        varianceCombinations[l][j] = currentVariance + varianceCombinations[i4][j - 1]
                    }
                }
            }
        }
        lowerClassLimits[l][1] = 1
        varianceCombinations[l][1] = currentVariance
    }
    return {lowerClassLimits: lowerClassLimits, varianceCombinations: varianceCombinations}
}

/**
 * The breaks of the classes of the Jenks natural breaks
 * @param data sorted
 * @param lowerClassLimits
 * @param nClasses
 */
function jenksBreaks(data: number[], lowerClassLimits: number[][], nClasses: number): number[] {
    let k: number = data.length
    const kClass: number[] = []
    let countNum: number = nClasses
    kClass[nClasses] = data[data.length - 1]
    while (countNum > 0) {
        kClass[countNum - 1] = data[lowerClassLimits[k][countNum] - 1]
        k = lowerClassLimits[k][countNum] - 1
        countNum--
    }
    return kClass
}

export function jenks(data: number[], nClasses: number): number[] | null {
    if (nClasses > data.length) return null
    const sorted: number[] = data.slice().sort((a: number, b: number): number => a - b)
    return jenksBreaks(sorted, jenksMatrices(sorted, nClasses).lowerClassLimits, nClasses)
}
