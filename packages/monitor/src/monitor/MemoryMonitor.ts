import * as os from 'node:os'
import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {IMemoryMonitorStatistics} from './interfaces/IMemoryMonitorStatistics.js'
import {Round, Samples} from './lib/Samples.js'

/**
 * The memory of the process (bytes), sampled when the monitor is created then every second
 */
export class MemoryMonitor extends Component implements IMonitor<IMemoryMonitorStatistics> {

    readonly #fractionDigits: number = 2

    readonly #intervalDelay: number = 1000

    readonly #totalMemorySize: number = os.totalmem()

    readonly #physical: Samples = new Samples()

    readonly #heap: Samples = new Samples()

    readonly #external: Samples = new Samples()

    #latest: NodeJS.MemoryUsage = process.memoryUsage()

    #sampleInterval: NodeJS.Timeout | undefined

    public get statistics(): IMemoryMonitorStatistics {
        const latest: NodeJS.MemoryUsage = this.#latest
        return {
            physicalTotal: this.#totalMemorySize,
            physicalUsed: latest.rss,
            physicalUsage: Round(latest.rss / this.#totalMemorySize * 100, this.#fractionDigits),
            physicalUsedMin: this.#physical.min,
            physicalUsedMax: this.#physical.max,
            physicalUsedAvg: Round(this.#physical.mean, this.#fractionDigits),
            physicalUsedP50: this.#physical.percentile(50),
            physicalUsedP90: this.#physical.percentile(90),
            physicalUsedP95: this.#physical.percentile(95),
            physicalUsedP99: this.#physical.percentile(99),
            heapTotal: latest.heapTotal,
            heapUsed: latest.heapUsed,
            heapUsage: Round(latest.heapTotal ? latest.heapUsed / latest.heapTotal * 100 : 0, this.#fractionDigits),
            heapUsedMin: this.#heap.min,
            heapUsedMax: this.#heap.max,
            heapUsedAvg: Round(this.#heap.mean, this.#fractionDigits),
            heapUsedP50: this.#heap.percentile(50),
            heapUsedP90: this.#heap.percentile(90),
            heapUsedP95: this.#heap.percentile(95),
            heapUsedP99: this.#heap.percentile(99),
            externalUsed: latest.external,
            externalUsedMin: this.#external.min,
            externalUsedMax: this.#external.max,
            externalUsedAvg: Round(this.#external.mean, this.#fractionDigits),
            externalUsedP50: this.#external.percentile(50),
            externalUsedP90: this.#external.percentile(90),
            externalUsedP95: this.#external.percentile(95),
            externalUsedP99: this.#external.percentile(99)
        }
    }

    /**
     * Sample the memory of the process
     * @protected
     */
    protected sampleMemoryUsage(): void {
        const usage: NodeJS.MemoryUsage = process.memoryUsage()
        this.#latest = usage
        this.#physical.record(usage.rss)
        this.#heap.record(usage.heapUsed)
        this.#external.record(usage.external)
    }

    protected async init(): Promise<void> {
        this.sampleMemoryUsage()
        this.#sampleInterval = setInterval((): void => this.sampleMemoryUsage(), this.#intervalDelay).unref()
    }

    protected async destroy(): Promise<void> {
        clearInterval(this.#sampleInterval)
    }

    /**
     * Forget the samples (the latest usage is kept)
     */
    public reset(): void {
        this.#physical.reset()
        this.#heap.reset()
        this.#external.reset()
    }
}
