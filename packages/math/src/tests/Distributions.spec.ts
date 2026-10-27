import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {type Distribution, Math, MathArgumentException, RandomGenerator} from '../exports/Math.js'

describe('The distributions and the random numbers', (): void => {
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

    it('take their parameters by their names, the others of their default values, and check them', (): void => {
        const normal: Distribution = math.stats.normal()
        assert.deepStrictEqual(normal.parameters, {mean: 0, standardDeviation: 1})
        assert.deepStrictEqual([normal.name, normal.kind, normal.support], ['normal', 'continuous', [-Infinity, Infinity]])
        assert.deepStrictEqual(math.stats.gamma({shape: 2}).parameters, {shape: 2, scale: 1})
        assert.strictEqual(math.stats.distribution('exponential', {rate: 2}).mean, 0.5)
        const invalid: (() => unknown)[] = [
            (): unknown => math.stats.normal({standardDeviation: -1}),
            (): unknown => math.stats.normal({sd: 1} as unknown as {standardDeviation: number}),
            (): unknown => math.stats.normal({mean: NaN}),
            (): unknown => math.stats.gamma({} as {shape: number}),
            (): unknown => math.stats.gamma({shape: 0}),
            (): unknown => math.stats.beta({alpha: 1, beta: -1}),
            (): unknown => math.stats.binomial({trials: 2.5, probability: 0.5}),
            (): unknown => math.stats.binomial({trials: 10, probability: 1.5}),
            (): unknown => math.stats.poisson({mean: -1}),
            (): unknown => math.stats.triangular({lower: 0, mode: 5, upper: 4}),
            (): unknown => math.stats.hypergeometric({total: 5, successes: 7, draws: 3}),
            (): unknown => math.stats.distribution('student' as 'studentT', {degrees: 1}),
            (): unknown => math.stats.random(0.5),
            (): unknown => math.stats.random(1).integers(3, 5, 5),
            (): unknown => math.stats.normal().sample(2, {} as RandomGenerator)
        ]
        for (const operation of invalid) assert.throws(operation, MathArgumentException)
    })

    it('give the functions of SciPy outside the support and between the integers of a discrete distribution', (): void => {
        const gamma: Distribution = math.stats.gamma({shape: 2})
        assert.deepStrictEqual(gamma.support, [0, Infinity])
        assert.deepStrictEqual(gamma.pdf([-1, 0]), Float64Array.of(0, 0))
        assert.deepStrictEqual(gamma.cdf([-1, Infinity]), Float64Array.of(0, 1))
        assert.deepStrictEqual(gamma.survival([-1, Infinity]), Float64Array.of(1, 0))
        const binomial: Distribution = math.stats.binomial({trials: 10, probability: 0.3})
        assert.deepStrictEqual(binomial.pdf([2.5, -1, 11]), Float64Array.of(0, 0, 0))
        assert.strictEqual(binomial.cdf(2.5), binomial.cdf(2))
        assert.strictEqual(binomial.survival(2.5), binomial.survival(2))
        assert.strictEqual(math.stats.hypergeometric({total: 20, successes: 7, draws: 12}).cdf(4.5), math.stats.hypergeometric({total: 20, successes: 7, draws: 12}).cdf(4))
        assert.ok(Number.isNaN(binomial.cdf(NaN)) && Number.isNaN(binomial.quantile(1.5)) && Number.isNaN(math.stats.normal().quantile(-0.1)))
    })

    it('give the quantile of a discrete distribution as the smallest integer of a cdf at least p', (): void => {
        const binomial: Distribution = math.stats.binomial({trials: 10, probability: 0.3})
        //At its own cdf, exactly, and just above it
        assert.strictEqual(binomial.quantile(binomial.cdf(2)), 2)
        assert.strictEqual(binomial.quantile(binomial.cdf(2) + 1e-16), 3)
        assert.strictEqual(binomial.survivalQuantile(binomial.survival(2)), 2)
        //Its bounds: the lower one at 0 (SciPy gives one below it), the upper one at 1
        assert.deepStrictEqual(binomial.quantile([0, 1]), Float64Array.of(0, 10))
        assert.deepStrictEqual(binomial.survivalQuantile([1, 0]), Float64Array.of(0, 10))
        assert.deepStrictEqual(math.stats.poisson({mean: 2.5}).quantile([0, 1]), Float64Array.of(0, Infinity))
        //The geometric distribution counts the trials, from 1 (Boost's quantile is continuous: corrected)
        const geometric: Distribution = math.stats.geometric({probability: 0.3})
        assert.deepStrictEqual([geometric.support[0], geometric.mode, geometric.pdf(1), geometric.quantile(0.7)], [1, 1, 0.3, 4])
        assert.ok(globalThis.Math.abs(geometric.mean - 10 / 3) < 1e-15)
    })

    it('give the moments, NaN where they are undefined and infinite where they diverge', (): void => {
        const cauchy: Distribution = math.stats.cauchy()
        assert.ok(Number.isNaN(cauchy.mean) && Number.isNaN(cauchy.variance))
        assert.deepStrictEqual([cauchy.median, cauchy.mode], [0, 0])
        assert.strictEqual(math.stats.studentT({degrees: 2}).variance, Infinity)
        assert.strictEqual(math.stats.pareto({scale: 1, shape: 0.5}).mean, Infinity)
        assert.strictEqual(math.stats.normal({standardDeviation: 3}).standardDeviation, 3)
        //The excess kurtosis of the hypergeometric distribution: Boost's, corrected (it gave the full kurtosis)
        assert.ok(globalThis.Math.abs(math.stats.hypergeometric({total: 20, successes: 7, draws: 12}).excessKurtosis + 0.15266106442577032) < 1e-14)
        assert.strictEqual(math.stats.normal().excessKurtosis, 0)
    })

    it('draw the same numbers of the same seed, and samples by inversion', (): void => {
        //Integers only: the same on every platform
        assert.deepStrictEqual(math.stats.random(42).uniform(3), Float64Array.of(0.08386297105988222, 0.37898025066266866, 0.6800434110281395))
        assert.deepStrictEqual(math.stats.random(1).integers(10, 1, 7), Float64Array.of(2, 5, 3, 6, 6, 5, 3, 4, 2, 5))
        assert.deepStrictEqual(math.stats.random(2n ** 64n + 5n).uniform(1), math.stats.random(5).uniform(1))
        //Through the quantile: the last digits may differ between the C libraries
        const normal: Float64Array = math.stats.normal().sample(3, math.stats.random(7))
        Array.from([0.5260592571920801, -0.5865552288338926, 0.9929279326349372]).forEach((value: number, i: number): void => assert.ok(globalThis.Math.abs(normal[i] - value) < 1e-12))
        assert.deepStrictEqual(math.stats.binomial({trials: 10, probability: 0.3}).sample(8, math.stats.random(7)), Float64Array.of(4, 2, 4, 6, 7, 5, 1, 1))
        //A generator advances; its clone draws what it would
        const random: RandomGenerator = math.stats.random(5)
        const first: number = random.next()
        const clone: RandomGenerator = random.clone()
        assert.notStrictEqual(random.next(), first)
        assert.strictEqual(clone.next(), math.stats.random(5).uniform(2)[1])
        //Without a seed, of the system's random numbers
        assert.notDeepStrictEqual(math.stats.random().uniform(2), math.stats.random().uniform(2))
        const samples: Float64Array = math.stats.gamma({shape: 2.5, scale: 1.5}).sample(20000, math.stats.random(3))
        assert.ok(globalThis.Math.abs(math.stats.mean(samples) - 3.75) < 6 * globalThis.Math.sqrt(5.625 / 20000))
        const integers: Float64Array = math.stats.random(9).integers(60000, 0, 6)
        for (let face: number = 0; face < 6; face++) {
            const count: number = integers.filter((value: number): boolean => value === face).length
            assert.ok(globalThis.Math.abs(count - 10000) < 6 * globalThis.Math.sqrt(60000 * (1 / 6) * (5 / 6)))
        }
    })
})
