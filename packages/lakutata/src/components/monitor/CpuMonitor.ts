import {IMonitor} from './interfaces/IMonitor.js'
import {ICpuMonitorStatistics} from './interfaces/ICpuMonitorStatistics.js'
import {average, max, min, quantile} from 'simple-statistics'
import {Component} from '../../lib/core/Component.js'

export class CpuMonitor extends Component implements IMonitor<ICpuMonitorStatistics> {

    readonly #fractionDigits: number = 5

    readonly #intervalDelay: number = 1000

    readonly #sampleCpuInterval: number = 100

    readonly #sampleRecordsLimit: number = 65535

    #sampleInterval: NodeJS.Timeout

    #samples: number[] = []

    #min: number = 0

    #max: number = 0

    public get statistics(): ICpuMonitorStatistics {
        const minVal: number = parseFloat(min(this.#samples).toFixed(this.#fractionDigits))
        if (!this.#min) this.#min = minVal
        this.#min = this.#min > minVal ? minVal : this.#min
        const maxVal: number = parseFloat(max(this.#samples).toFixed(this.#fractionDigits))
        if (!this.#max) this.#max = maxVal
        this.#max = this.#max < maxVal ? maxVal : this.#max
        return {
            usage: this.#samples[this.#samples.length - 1],
            usageMin: this.#min,
            usageMax: this.#max,
            usageAvg: parseFloat(average(this.#samples).toFixed(this.#fractionDigits)),
            usageP50: parseFloat(quantile(this.#samples, 0.50).toFixed(this.#fractionDigits)),
            usageP90: parseFloat(quantile(this.#samples, 0.90).toFixed(this.#fractionDigits)),
            usageP95: parseFloat(quantile(this.#samples, 0.95).toFixed(this.#fractionDigits)),
            usageP99: parseFloat(quantile(this.#samples, 0.99).toFixed(this.#fractionDigits))
        }
    }

    protected async sampleCpuUsage(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const previousCpuUsage: NodeJS.CpuUsage = process.cpuUsage()
                setTimeout(() => {
                    const currentUsage: NodeJS.CpuUsage = process.cpuUsage(previousCpuUsage)
                    const usage: number = (((currentUsage.user + currentUsage.system) / 1000) / this.#sampleCpuInterval) * 100
                    this.#samples.push(parseFloat(usage.toFixed(this.#fractionDigits)))
                    if (this.#samples.length > this.#sampleRecordsLimit) this.#samples.shift()
                    return resolve()
                }, this.#sampleCpuInterval)
            } catch (e) {
                return reject(e)
            }
        })
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await this.sampleCpuUsage()
        this.#sampleInterval = setInterval((): Promise<void> => this.sampleCpuUsage(), this.#intervalDelay)
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
        const latest: number = this.#samples[this.#samples.length - 1]
        this.#samples = []
        this.#samples.push(latest)
    }
}