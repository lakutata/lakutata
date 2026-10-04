import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as Upstream from 'simple-statistics'
import * as Port from '../lib/helpers/internal/SimpleStatistics.js'
import {Statistics} from '../exports/Utils.js'

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = Random(20261001)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * A random array of numbers: empty, short or long (quickselect changes above 600), with duplicates, negative,
 * decimal or zero
 */
function Numbers(): number[] {
    const length: number = pick([0, 1, 2, 3, 5, 10, 50, 700])
    const kind: number = Math.floor(random() * 4)
    return Array.from({length: length}, (): number => {
        if (kind === 0) return Math.floor(random() * 10)
        if (kind === 1) return (random() - 0.5) * 1000
        if (kind === 2) return Math.floor(random() * 100) + 1
        return pick([0, 1, -1, 2.5, 1e-9, 1e9])
    })
}

const probability = (): number => pick([0, 1, 0.5, 0.25, 0.75, 0.1, 0.99, -0.1, 1.1, random()])

/**
 * The arguments of the functions compared, for a run
 */
const ARGUMENTS: Record<string, () => unknown[]> = {
    sum: (): unknown[] => [Numbers()], mean: (): unknown[] => [Numbers()], average: (): unknown[] => [Numbers()],
    min: (): unknown[] => [Numbers()], max: (): unknown[] => [Numbers()], product: (): unknown[] => [Numbers()],
    extent: (): unknown[] => [Numbers()], mode: (): unknown[] => [Numbers()], median: (): unknown[] => [Numbers()],
    variance: (): unknown[] => [Numbers()], standardDeviation: (): unknown[] => [Numbers()],
    sampleVariance: (): unknown[] => [Numbers()], sampleStandardDeviation: (): unknown[] => [Numbers()],
    sampleSkewness: (): unknown[] => [Numbers()], harmonicMean: (): unknown[] => [Numbers()],
    geometricMean: (): unknown[] => [Numbers()], logAverage: (): unknown[] => [Numbers()],
    rootMeanSquare: (): unknown[] => [Numbers()], medianAbsoluteDeviation: (): unknown[] => [Numbers()],
    interquartileRange: (): unknown[] => [Numbers()], coefficientOfVariation: (): unknown[] => [Numbers()],
    sumNthPowerDeviations: (): unknown[] => [Numbers(), pick([1, 2, 3, 4])],
    quantile: (): unknown[] => [Numbers(), random() < 0.3 ? [probability(), probability(), probability()] : probability()],
    quantileRank: (): unknown[] => [Numbers(), pick([0, 5, -1, 50, 2.5, 1000])],
    addToMean: (): unknown[] => [random() * 10, pick([0, 1, 5]), random() * 10],
    subtractFromMean: (): unknown[] => [random() * 10, pick([1, 2, 5]), random() * 10],
    combineMeans: (): unknown[] => [random(), 3, random(), 4],
    combineVariances: (): unknown[] => [random(), random(), 3, random(), random(), 4],
    zScore: (): unknown[] => [random() * 10, random() * 10, pick([1, 2, 0])],
    sampleCovariance: (): unknown[] => {
        const x: number[] = Numbers()
        return [x, random() < 0.8 ? x.map((value: number): number => value * random()) : Numbers()]
    },
    sampleCorrelation: (): unknown[] => {
        const x: number[] = Numbers()
        return [x, x.map((value: number): number => value + random())]
    },
    linearRegression: (): unknown[] => [Array.from({length: pick([1, 2, 5, 20])}, (): number[] => [random() * 10, random() * 10])],
    tTest: (): unknown[] => [Numbers(), random() * 10],
    tTestTwoSample: (): unknown[] => [Numbers(), Numbers(), pick([undefined, 0, 1])],
    bernoulliDistribution: (): unknown[] => [probability()],
    binomialDistribution: (): unknown[] => [pick([0, 1, 5, 10, 2.5, -1]), probability()],
    poissonDistribution: (): unknown[] => [pick([0, 1, 3.5, 10, -1])],
    chunk: (): unknown[] => [Numbers(), pick([1, 2, 3, 0, 1.5])],
    factorial: (): unknown[] => [pick([0, 1, 5, 10, 20, -1, 2.5])],
    //Not the fractions below 10: the upstream overflows the stack between 0 and 1, and is imprecise below 10 (see the
    //fixes below)
    gamma: (): unknown[] => [pick([1, 5, 0, -1, 10.1, 12.5, -10.5, 30.25])],
    gammaln: (): unknown[] => [pick([1, 5, 0, -1, 0.5, 2.5, 100])],
    approxEqual: (): unknown[] => [pick([0, 1, 1.00001, 2]), pick([0, 1, 2]), pick([undefined, 0.1, 0.0001])],
    combinations: (): unknown[] => [Numbers().slice(0, 6), pick([1, 2, 3])],
    combinationsReplacement: (): unknown[] => [Numbers().slice(0, 5), pick([1, 2, 3])],
    cumulativeStdLogisticProbability: (): unknown[] => [(random() - 0.5) * 20],
    jenks: (): unknown[] => [Numbers().slice(0, 60), pick([1, 2, 3, 5])],
    logit: (): unknown[] => [probability()],
    probit: (): unknown[] => [probability()],
    epsilonValue: (): unknown[] => []
}

/**
 * The result or the error of a function
 * @param fn
 */
function Outcome(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        return {value: fn()}
    } catch (error) {
        return {error: `${(error as Error).name}: ${(error as Error).message}`}
    }
}

describe('Statistics', (): void => {

    it('computes as simple-statistics', (): void => {
        const port: Record<string, (...args: unknown[]) => unknown> = Port as never
        const upstream: Record<string, (...args: unknown[]) => unknown> = Upstream as never
        for (const [name, args] of Object.entries(ARGUMENTS)) {
            if (name === 'epsilonValue') {
                assert.strictEqual(Port.epsilon, Upstream.epsilon)
                continue
            }
            for (let run: number = 0; run < 200; run++) {
                const input: unknown[] = args()
                //The functions may change their inputs (combinations), each one gets a copy
                const copy = (): unknown[] => structuredClone(input)
                assert.deepStrictEqual(Outcome((): unknown => port[name](...copy())), Outcome((): unknown => upstream[name](...copy())), `${name}(${JSON.stringify(input).slice(0, 200)})`)
            }
        }
    })

    it('selects, shuffles and samples as simple-statistics with the same random source', (): void => {
        for (let run: number = 0; run < 200; run++) {
            const x: number[] = Numbers()
            const k: number = Math.floor(random() * Math.max(x.length, 1))
            const portArray: number[] = x.slice()
            const upstreamArray: number[] = x.slice()
            Port.quickselect(portArray, k)
            Upstream.quickselect(upstreamArray, k)
            assert.deepStrictEqual(portArray, upstreamArray)
            const seed: number = Math.floor(random() * 1e9)
            assert.deepStrictEqual(Port.shuffle(x, Random(seed)), Upstream.shuffle(x, Random(seed)))
            assert.deepStrictEqual(Port.sample(x, 3, Random(seed)), Upstream.sample(x, 3, Random(seed)))
            assert.deepStrictEqual(Port.sampleWithReplacement(x, 4, Random(seed)), Upstream.sampleWithReplacement(x, 4, Random(seed)))
        }
    })

    it('finds the roots and the regression lines as simple-statistics', (): void => {
        const cubic = (x: number): number => x * x * x - 2
        assert.strictEqual(Port.bisect(cubic, 0, 2, 100, 1e-9), Upstream.bisect(cubic, 0, 2, 100, 1e-9))
        assert.throws((): unknown => Port.bisect(cubic, 0, 2, 3, 1e-9), /maximum number of iterations exceeded/)
        const data: number[][] = [[0, 1], [1, 3], [2, 5.1], [3, 6.9]]
        const line: (x: number) => number = Port.linearRegressionLine(Port.linearRegression(data))
        assert.strictEqual(Port.rSquared(data, line), Upstream.rSquared(data as [number, number][], Upstream.linearRegressionLine(Upstream.linearRegression(data as [number, number][]))))
    })

    it('keeps the API of Statistics', (): void => {
        assert.strictEqual(Statistics.min([3, 1, 2]), 1)
        assert.strictEqual(Statistics.average([1, 2, 3]), 2)
        assert.strictEqual(Statistics.max([3, 1, 2]), 3)
        assert.strictEqual(Statistics.quantile([1, 2, 3, 4], 0.5), 2.5)
        //Statistics.quickselect returns a rearranged copy, the upstream rearranges its input
        const selected: number[] = [5, 1, 4, 2, 3]
        Upstream.quickselect(selected, 2)
        assert.deepStrictEqual(Statistics.quickselect([5, 1, 4, 2, 3], 2), selected)
        assert.strictEqual(Statistics.jenks([1, 2], 3), null)
        assert.strictEqual(Statistics.binomialDistribution(-1, 0.5), undefined)
    })

    it('computes the gamma function of the fractions below 10 precisely, by the recurrence upward', (): void => {
        const close = (actual: number, expected: number, precision: number): boolean => Math.abs(actual - expected) / Math.abs(expected) < precision
        assert.ok(close(Statistics.gamma(0.5), Math.sqrt(Math.PI), 1e-9), String(Statistics.gamma(0.5)))
        //gamma(0.25) = 3.625609908221908…, gamma(0.1) = 9.513507698668731…, gamma(0.999) = 1.000578…
        assert.ok(close(Statistics.gamma(0.25), 3.625609908221908, 1e-9), String(Statistics.gamma(0.25)))
        assert.ok(close(Statistics.gamma(0.1), 9.513507698668731, 1e-9), String(Statistics.gamma(0.1)))
        assert.ok(close(Statistics.gamma(0.001), 999.4237724845955, 1e-9), String(Statistics.gamma(0.001)))
        //gamma(1.1) = 0.9513507698668731… (the upstream gives 1.2128), gamma(1.5) = √π / 2, gamma(9.5) = 119292.46199…
        assert.ok(close(Statistics.gamma(1.1), 0.9513507698668731, 1e-9), String(Statistics.gamma(1.1)))
        assert.ok(close(Statistics.gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-9), String(Statistics.gamma(1.5)))
        assert.ok(close(Statistics.gamma(9.5), 119292.46199394888, 1e-9), String(Statistics.gamma(9.5)))
        //The negative numbers by the reflection: gamma(-0.5) = -2√π, gamma(-2.5) = -0.9453087205…
        assert.ok(close(Statistics.gamma(-0.5), -2 * Math.sqrt(Math.PI), 1e-9), String(Statistics.gamma(-0.5)))
        assert.ok(close(Statistics.gamma(-2.5), -0.9453087204829419, 1e-9), String(Statistics.gamma(-2.5)))
    })

    it('lists the single empty combination of 0 items', (): void => {
        assert.deepStrictEqual(Statistics.combinationsReplacement([1, 2, 3], 0), [[]])
        assert.deepStrictEqual(Statistics.combinations([1, 2, 3], 0), [[]])
        assert.deepStrictEqual(Statistics.combinationsReplacement([1, 2, 3], -1), [])
        assert.deepStrictEqual(Statistics.combinationsReplacement([1, 2, 3], 1.5), [])
        assert.deepStrictEqual(Statistics.combinationsReplacement([1, 2], 2), [[1, 1], [1, 2], [2, 2]])
    })

    it('fits the regression lines of lists of points', (): void => {
        const points: [number, number][] = [[0, 1], [1, 3], [2, 5], [3, 7]]
        assert.deepStrictEqual(Statistics.linearRegression(points), {m: 2, b: 1})
        assert.strictEqual(Statistics.rSquared(points), 1)
    })
})
