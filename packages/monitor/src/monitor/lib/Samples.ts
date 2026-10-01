import {createHistogram, type RecordableHistogram} from 'node:perf_hooks'

/**
 * The statistics of the samples of a measure, in a constant memory: the latest value, the minimum, the maximum, the
 * mean and the standard deviation are exact, the percentiles come from a histogram (3 significant digits)
 */
export class Samples {

    /**
     * The histogram of the percentiles: it records integers from 1, so a value is recorded multiplied by the scale,
     * plus 1 (a value may be 0)
     */
    #histogram: RecordableHistogram = createHistogram()

    #count: number = 0

    #latest: number = 0

    #min: number = 0

    #max: number = 0

    #mean: number = 0

    //The sum of the squares of the differences from the mean (Welford's algorithm)
    #m2: number = 0

    /**
     * @param scale the factor of the precision of the percentiles (100 keeps 2 decimals)
     */
    constructor(protected readonly scale: number = 1) {
    }

    /**
     * Record a sample (a negative value is recorded as 0)
     * @param value
     */
    public record(value: number): void {
        const sample: number = Number.isFinite(value) && value > 0 ? value : 0
        this.#histogram.record(Math.round(sample * this.scale) + 1)
        this.#count++
        this.#latest = sample
        if (this.#count === 1) {
            this.#min = sample
            this.#max = sample
        } else {
            if (sample < this.#min) this.#min = sample
            if (sample > this.#max) this.#max = sample
        }
        const delta: number = sample - this.#mean
        this.#mean += delta / this.#count
        this.#m2 += delta * (sample - this.#mean)
    }

    /**
     * The number of samples
     */
    public get count(): number {
        return this.#count
    }

    /**
     * The latest sample, 0 without sample
     */
    public get latest(): number {
        return this.#latest
    }

    /**
     * The minimum, 0 without sample
     */
    public get min(): number {
        return this.#min
    }

    /**
     * The maximum, 0 without sample
     */
    public get max(): number {
        return this.#max
    }

    /**
     * The mean, 0 without sample
     */
    public get mean(): number {
        return this.#mean
    }

    /**
     * The (population) standard deviation, 0 without sample
     */
    public get stdDev(): number {
        return this.#count ? Math.sqrt(this.#m2 / this.#count) : 0
    }

    /**
     * A percentile, 0 without sample
     * @param percentile from 0 to 100
     */
    public percentile(percentile: number): number {
        if (!this.#count) return 0
        return Math.min(Math.max((this.#histogram.percentile(percentile) - 1) / this.scale, this.#min), this.#max)
    }

    /**
     * Forget the samples
     */
    public reset(): void {
        this.#histogram.reset()
        this.#count = 0
        this.#latest = 0
        this.#min = 0
        this.#max = 0
        this.#mean = 0
        this.#m2 = 0
    }
}

/**
 * Round a number to a number of decimals
 * @param value
 * @param fractionDigits
 * @constructor
 */
export function Round(value: number, fractionDigits: number): number {
    return parseFloat(value.toFixed(fractionDigits))
}
