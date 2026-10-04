import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {ICpuMonitorStatistics} from './interfaces/ICpuMonitorStatistics.js'
import {Round, Samples} from './lib/Samples.js'

/**
 * The CPU monitor: measures the CPU time the process uses (user plus system, all its threads), as a percentage of one
 * core: 100 is one core fully busy, and a process using several cores (worker threads, the libuv thread pool) goes
 * above 100. It takes a sample every second, each the average usage over that second, and keeps the statistics of
 * every sample since it was created or last {@link CpuMonitor.reset}: the latest, the minimum, the maximum, the mean
 * and percentiles, in constant memory.
 *
 * Declare it in the `components` of the application (`{class: CpuMonitor}`) and get it with `@Inject` or
 * `getObject()`; it is a singleton. It starts sampling when it is created: list it in `bootstrap` to measure from the
 * launch. The statistics are all 0 until the first sample, one second after its creation. Its timer does not keep the
 * process alive, and stops when the component is destroyed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {CpuMonitor, type ICpuMonitorStatistics} from 'lakutata/com/monitor'
 *
 * Application
 *     .run(() => ({
 *         id: 'cpu.app',
 *         name: 'Cpu',
 *         components: {
 *             cpu: {class: CpuMonitor}
 *         },
 *         //Created at the launch, so that it samples from the start
 *         bootstrap: ['cpu']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const cpu: CpuMonitor = await app.getObject('cpu')
 *         setInterval((): void => {
 *             const statistics: ICpuMonitorStatistics = cpu.statistics
 *             console.log(`CPU ${statistics.usage}% (p95 ${statistics.usageP95}%, max ${statistics.usageMax}%)`)
 *         }, 60000)
 *     })
 * ```
 */
export class CpuMonitor extends Component implements IMonitor<ICpuMonitorStatistics> {

    readonly #fractionDigits: number = 5

    readonly #intervalDelay: number = 1000

    readonly #samples: Samples = new Samples(1e5)

    #sampleInterval: NodeJS.Timeout | undefined

    #previousUsage: NodeJS.CpuUsage = process.cpuUsage()

    #previousTime: bigint = process.hrtime.bigint()

    /**
     * The statistics of the CPU samples since the monitor was created or reset, computed at each read: the latest
     * usage and the minimum, maximum, mean and percentiles (P50 to P99) of the samples, in percent of one core, rounded
     * to 5 decimals. The percentiles are approximate (3 significant digits). All 0 before the first sample.
     */
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
     * Take a sample: the CPU usage since the previous sample (user plus system time over the elapsed time, in percent of
     * one core). Called every second.
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
     * Forget the samples: the statistics are 0 until the next sample, then cover the samples taken since. Use it to
     * measure a period, such as between two reports.
     */
    public reset(): void {
        this.#samples.reset()
    }
}
