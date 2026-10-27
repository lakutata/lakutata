import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {Math, MathArgumentException} from '../exports/Math.js'

describe('The statistics', (): void => {
    let container: Container
    let math: Math

    before(async (): Promise<void> => {
        container = new Container()
        await container.setNamed('math', Math, {})
        math = await container.get<Math>('math')
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    const values: number[] = [2, 4, 4, 4, 5, 5, 7, 9]

    it('sum the values with their roundings compensated', (): void => {
        assert.strictEqual(math.stats.sum([0.1, 0.2, 0.3]), 0.6)
        assert.strictEqual(math.stats.sum([1e16, 1, -1e16]), 1)
        assert.strictEqual(math.stats.sum(Float64Array.of(1e100, 1, -1e100, 3)), 4)
        assert.strictEqual(math.stats.sum([]), 0)
        assert.strictEqual(math.stats.sum([1, Infinity, 2]), Infinity)
        assert.ok(Number.isNaN(math.stats.sum([Infinity, -Infinity])))
        assert.deepStrictEqual(math.stats.cumulativeSum([1e16, 1, -1e16, 1]), Float64Array.of(1e16, 1e16, 1, 2))
        assert.strictEqual(math.stats.product([1.5, -2, 4, 0.25]), -3)
        assert.strictEqual(math.stats.product([]), 1)
        assert.deepStrictEqual(math.stats.differences(values), Float64Array.of(2, 0, 0, 1, 0, 2, 2))
        assert.deepStrictEqual(math.stats.differences([5]), new Float64Array(0))
    })

    it('give the means, the medians, the modes, the smallest and the largest values', (): void => {
        assert.strictEqual(math.stats.mean(values), 5)
        assert.strictEqual(math.stats.mean([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]), 1e9 + 10)
        assert.strictEqual(math.stats.median(values), 4.5)
        assert.strictEqual(math.stats.median([3, 1, 2]), 2)
        assert.strictEqual(math.stats.median([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE)
        assert.deepStrictEqual(math.stats.mode(values), Float64Array.of(4))
        //All of them, ascending
        assert.deepStrictEqual(math.stats.mode([3, 1, 2, 3, 1]), Float64Array.of(1, 3))
        assert.deepStrictEqual([math.stats.min(values), math.stats.max(values)], [2, 9])
    })

    it('give the variances by the normalization asked, n by default', (): void => {
        assert.strictEqual(math.stats.variance(values), 4)
        assert.strictEqual(math.stats.variance(values, {normalization: 'uncorrected'}), 4)
        assert.strictEqual(math.stats.variance(values, {normalization: 'unbiased'}), 32 / 7)
        assert.strictEqual(math.stats.variance(values, {normalization: 'biased'}), 32 / 9)
        assert.strictEqual(math.stats.standardDeviation(values), 2)
        assert.strictEqual(math.stats.standardDeviation(values, {normalization: 'unbiased'}), globalThis.Math.sqrt(32 / 7))
        //Two passes: no cancellation under a large offset
        assert.strictEqual(math.stats.variance([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]), 22.5)
        assert.ok(Number.isNaN(math.stats.variance([5], {normalization: 'unbiased'})))
        assert.strictEqual(math.stats.variance([5]), 0)
        assert.strictEqual(math.stats.medianAbsoluteDeviation([1, 2, 3, 4, 100]), 1)
    })

    it('give the quantiles by linear interpolation', (): void => {
        assert.strictEqual(math.stats.quantile(values, 0.4), 4)
        assert.deepStrictEqual(math.stats.quantile(values, [0, 0.1, 0.5, 0.9, 1]), Float64Array.of(2, 3.4000000000000004, 4.5, 7.6, 9))
        assert.deepStrictEqual(math.stats.quantile([1, 2, 3, 4], Float64Array.of(0.33)), Float64Array.of(1.99))
    })

    it('give the covariances, the correlations, the z-scores and the divergences', (): void => {
        const other: number[] = [1, 3, 2, 5, 4, 6, 8, 7]
        assert.strictEqual(math.stats.covariance(values, other), 3.875)
        assert.ok(globalThis.Math.abs(math.stats.covariance(values, other, {normalization: 'unbiased'}) - 31 / 7) < 1e-15)
        assert.strictEqual(math.stats.covariance(values, values), math.stats.variance(values))
        assert.ok(globalThis.Math.abs(math.stats.correlation(values, other) - 0.8455943246644705) < 1e-15)
        assert.strictEqual(math.stats.correlation(values, values), 1)
        assert.ok(globalThis.Math.abs(math.stats.correlation([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16], [1, 3, 2, 4]) - globalThis.Math.SQRT1_2) < 1e-15)
        assert.ok(Number.isNaN(math.stats.correlation([1, 1, 1], [1, 2, 3])))
        assert.deepStrictEqual(math.stats.zScores(values), Float64Array.of(-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2))
        assert.ok(globalThis.Math.abs(math.stats.klDivergence([0.2, 0.3, 0.5], [0.3, 0.3, 0.4]) - 0.030478754035471997) < 1e-16)
        //Scaled to sums of 1; a term of p = 0 is 0, one of q = 0 infinite
        assert.strictEqual(math.stats.klDivergence([2, 3, 5], [3, 3, 4]), math.stats.klDivergence([0.2, 0.3, 0.5], [0.3, 0.3, 0.4]))
        assert.strictEqual(math.stats.klDivergence([1, 0], [0.5, 0.5]), globalThis.Math.LN2)
        assert.strictEqual(math.stats.klDivergence([0.5, 0.5], [1, 0]), Infinity)
    })

    it('give NaN of NaN, and throw where the values have no statistic', (): void => {
        for (const statistic of [(x: number[]): unknown => math.stats.mean(x), (x: number[]): unknown => math.stats.median(x), (x: number[]): unknown => math.stats.variance(x), (x: number[]): unknown => math.stats.min(x), (x: number[]): unknown => math.stats.medianAbsoluteDeviation(x)]) {
            assert.ok(Number.isNaN(statistic([1, NaN, 3])))
            assert.throws((): unknown => statistic([]), MathArgumentException)
        }
        assert.deepStrictEqual(math.stats.mode([1, NaN]), Float64Array.of(NaN))
        assert.deepStrictEqual(math.stats.quantile([1, NaN], [0.5, 1]), Float64Array.of(NaN, NaN))
        const invalid: (() => unknown)[] = [
            (): unknown => math.stats.quantile(values, 1.5),
            (): unknown => math.stats.quantile(values, [0.5, -0.1]),
            (): unknown => math.stats.variance(values, {normalization: 'sample' as 'unbiased'}),
            (): unknown => math.stats.covariance([1, 2], [1]),
            (): unknown => math.stats.correlation([1, 2], [1, 2, 3]),
            (): unknown => math.stats.klDivergence([-1, 2], [1, 1]),
            (): unknown => math.stats.klDivergence([0, 0], [1, 1]),
            (): unknown => math.stats.klDivergence([1], [1, 1]),
            (): unknown => math.stats.mode([]),
            (): unknown => math.stats.sum(['1' as unknown as number])
        ]
        for (const operation of invalid) assert.throws(operation, MathArgumentException)
    })
})
