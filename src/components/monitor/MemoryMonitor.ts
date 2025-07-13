import {IMonitor} from './interfaces/IMonitor.js'
import {IMemoryMonitorStatistics} from './interfaces/IMemoryMonitorStatistics.js'
import * as os from 'node:os'
import {average, max, min, quantile} from 'simple-statistics'
import {Component} from '../../lib/core/Component.js'

export class MemoryMonitor extends Component implements IMonitor<IMemoryMonitorStatistics> {

    readonly #fractionDigits: number = 2

    readonly #intervalDelay: number = 1000

    readonly #sampleRecordsLimit: number = 65535

    readonly #totalMemorySize: number = os.totalmem()

    #sampleInterval: NodeJS.Timeout

    #samples: NodeJS.MemoryUsage[] = []

    #physicalUsedMin: number = 0
    #physicalUsedMax: number = 0
    #heapUsedMin: number = 0
    #heapUsedMax: number = 0
    #externalUsedMin: number = 0
    #externalUsedMax: number = 0

    public get statistics(): IMemoryMonitorStatistics {
        const latestUsage: NodeJS.MemoryUsage = this.#samples[this.#samples.length - 1]
        const rssSamples: number[] = this.#samples.map((sample: NodeJS.MemoryUsage): number => sample.rss)
        const physicalUsedMin: number = min(rssSamples)
        const physicalUsedMax: number = max(rssSamples)
        if (!this.#physicalUsedMin) this.#physicalUsedMin = physicalUsedMin
        this.#physicalUsedMin = this.#physicalUsedMin > physicalUsedMin ? physicalUsedMin : this.#physicalUsedMin
        if (!this.#physicalUsedMax) this.#physicalUsedMax = physicalUsedMax
        this.#physicalUsedMax = this.#physicalUsedMax < physicalUsedMax ? physicalUsedMax : this.#physicalUsedMax
        const heapUsedSamples: number[] = this.#samples.map((sample: NodeJS.MemoryUsage): number => sample.heapUsed)
        const heapUsedMin: number = min(heapUsedSamples)
        const heapUsedMax: number = max(heapUsedSamples)
        if (!this.#heapUsedMin) this.#heapUsedMin = heapUsedMin
        this.#heapUsedMin = this.#heapUsedMin > heapUsedMin ? heapUsedMin : this.#heapUsedMin
        if (!this.#heapUsedMax) this.#heapUsedMax = heapUsedMax
        this.#heapUsedMax = this.#heapUsedMax < heapUsedMax ? heapUsedMax : this.#heapUsedMax
        const externalSamples: number[] = this.#samples.map((sample: NodeJS.MemoryUsage): number => sample.external)
        const externalUsedMin: number = min(externalSamples)
        const externalUsedMax: number = max(externalSamples)
        if (!this.#externalUsedMin) this.#externalUsedMin = externalUsedMin
        this.#externalUsedMin = this.#externalUsedMin > externalUsedMin ? externalUsedMin : this.#externalUsedMin
        if (!this.#externalUsedMax) this.#externalUsedMax = externalUsedMax
        this.#externalUsedMax = this.#externalUsedMax < externalUsedMax ? externalUsedMax : this.#externalUsedMax
        return {
            physicalTotal: this.#totalMemorySize,
            physicalUsed: latestUsage.rss,
            physicalUsage: parseFloat(((latestUsage.rss / this.#totalMemorySize) * 100).toFixed(this.#fractionDigits)),
            physicalUsedMin: this.#physicalUsedMin,
            physicalUsedMax: this.#physicalUsedMax,
            physicalUsedAvg: parseFloat(average(rssSamples).toFixed(this.#fractionDigits)),
            physicalUsedP50: quantile(rssSamples, 0.50),
            physicalUsedP90: quantile(rssSamples, 0.90),
            physicalUsedP95: quantile(rssSamples, 0.95),
            physicalUsedP99: quantile(rssSamples, 0.99),
            heapTotal: latestUsage.heapTotal,
            heapUsed: latestUsage.heapUsed,
            heapUsage: parseFloat(((latestUsage.heapUsed / latestUsage.heapTotal) * 100).toFixed(this.#fractionDigits)),
            heapUsedMin: this.#heapUsedMin,
            heapUsedMax: this.#heapUsedMax,
            heapUsedAvg: parseFloat(average(heapUsedSamples).toFixed(this.#fractionDigits)),
            heapUsedP50: quantile(heapUsedSamples, 0.50),
            heapUsedP90: quantile(heapUsedSamples, 0.90),
            heapUsedP95: quantile(heapUsedSamples, 0.95),
            heapUsedP99: quantile(heapUsedSamples, 0.99),
            externalUsed: latestUsage.external,
            externalUsedMin: this.#externalUsedMin,
            externalUsedMax: this.#externalUsedMax,
            externalUsedAvg: parseFloat(average(externalSamples).toFixed(this.#fractionDigits)),
            externalUsedP50: quantile(externalSamples, 0.50),
            externalUsedP90: quantile(externalSamples, 0.90),
            externalUsedP95: quantile(externalSamples, 0.95),
            externalUsedP99: quantile(externalSamples, 0.99)
        }
    }

    protected sampleMemoryUsage(): void {
        this.#samples.push(process.memoryUsage())
        if (this.#samples.length > this.#sampleRecordsLimit) this.#samples.shift()
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.sampleMemoryUsage()
        this.#sampleInterval = setInterval((): void => this.sampleMemoryUsage(), this.#intervalDelay)
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        clearInterval(this.#sampleInterval)
    }

    /**
     * Reset statistics
     */
    public reset(): void {
        this.#samples = []
        this.sampleMemoryUsage()
    }
}