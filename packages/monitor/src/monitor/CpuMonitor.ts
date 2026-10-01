import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {ICpuMonitorStatistics} from './interfaces/ICpuMonitorStatistics.js'
import {Round, Samples} from './lib/Samples.js'

/**
 * The CPU usage of the process (percent of one core, above 100 with several cores), sampled every second over the
 * whole second
 */
export class CpuMonitor extends Component implements IMonitor<ICpuMonitorStatistics> {

    readonly #fractionDigits: number = 5

    readonly #intervalDelay: number = 1000

    readonly #samples: Samples = new Samples(1e5)

    #sampleInterval: NodeJS.Timeout | undefined

    #previousUsage: NodeJS.CpuUsage = process.cpuUsage()

    #previousTime: bigint = process.hrtime.bigint()

    public get statistics(): ICpuMonitorStatistics {
        return {
            usage: Round(this.#samples.latest, this.#fractionDigits),
            usageMin: Round(this.#samples.min, this.#fractionDigits),
            usageMax: Round(this.#samples.max, this.#fractionDigits),
            usageAvg: Round(this.#samples.mean, this.#fractionDigits),
            usageP50: Round(this.#samples.percentile(50), this.#fractionDigits),
            usageP90: Round(this.#samples.percentile(90), this.#fractionDigits),
            usageP95: Round(this.#samples.percentile(95), this.#fractionDigits),
            usageP99: Round(this.#samples.percentile(99), this.#fractionDigits)
        }
    }

    /**
     * Sample the CPU usage since the previous sample
     * @protected
     */
    protected sampleCpuUsage(): void {
        const now: bigint = process.hrtime.bigint()
        const usage: NodeJS.CpuUsage = process.cpuUsage()
        const cpuMicroseconds: number = (usage.user - this.#previousUsage.user) + (usage.system - this.#previousUsage.system)
        const elapsedMicroseconds: number = Number(now - this.#previousTime) / 1000
        this.#previousUsage = usage
        this.#previousTime = now
        if (elapsedMicroseconds > 0) this.#samples.record(cpuMicroseconds / elapsedMicroseconds * 100)
    }

    protected async init(): Promise<void> {
        this.#previousUsage = process.cpuUsage()
        this.#previousTime = process.hrtime.bigint()
        this.#sampleInterval = setInterval((): void => this.sampleCpuUsage(), this.#intervalDelay).unref()
    }

    protected async destroy(): Promise<void> {
        clearInterval(this.#sampleInterval)
    }

    /**
     * Forget the samples
     */
    public reset(): void {
        this.#samples.reset()
    }
}
