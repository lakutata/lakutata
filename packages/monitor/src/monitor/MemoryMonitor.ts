import * as os from 'node:os'
import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {IMemoryMonitorStatistics} from './interfaces/IMemoryMonitorStatistics.js'
import {round, Samples} from './lib/Samples.js'

/**
 * The memory monitor: measures the memory of the process, in bytes, with `process.memoryUsage()`: its resident set
 * (the physical memory it occupies, `rss`), its V8 heap (`heapTotal` reserved, `heapUsed` occupied by the JavaScript
 * objects) and its external memory (the C++ objects bound to JavaScript ones, the `Buffer`s included). It takes a
 * sample when it is created then every second, and keeps the statistics of every sample since it was created or last
 * {@link MemoryMonitor.reset}: the minimum, the maximum, the mean and percentiles, in constant memory.
 *
 * Declare it in the `components` of the application (`{class: MemoryMonitor}`) and get it with `@Inject` or
 * `getObject()`; it is a singleton. It starts sampling when it is created: list it in `bootstrap` to measure from the
 * launch. Its timer does not keep the process alive, and stops when the component is destroyed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {MemoryMonitor, type IMemoryMonitorStatistics} from 'lakutata/com/monitor'
 *
 * Application
 *     .run(() => ({
 *         id: 'memory.app',
 *         name: 'Memory',
 *         components: {
 *             memory: {class: MemoryMonitor}
 *         },
 *         bootstrap: ['memory']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const memory: MemoryMonitor = await app.getObject('memory')
 *         setInterval((): void => {
 *             const statistics: IMemoryMonitorStatistics = memory.statistics
 *             const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(1)
 *             console.log(`RSS ${megabytes(statistics.physicalUsed)} MB (${statistics.physicalUsage}% of the host), heap ${statistics.heapUsage}% used`)
 *         }, 60000)
 *     })
 * ```
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

    /**
     * The memory statistics, computed at each read: the latest sample (`physicalUsed`, `heapTotal`, `heapUsed`,
     * `externalUsed`, in bytes, and the percentages `physicalUsage` and `heapUsage`, rounded to 2 decimals), the host's
     * total memory, and the minimum, maximum, mean (rounded to 2 decimals) and percentiles of the samples since the
     * monitor was created or reset. The percentiles are approximate (3 significant digits). The statistics of the
     * samples are 0 after a reset until the next sample.
     */
    public get statistics(): IMemoryMonitorStatistics {
        const latest: NodeJS.MemoryUsage = this.#latest
        return {
            physicalTotal: this.#totalMemorySize,
            physicalUsed: latest.rss,
            physicalUsage: round(latest.rss / this.#totalMemorySize * 100, this.#fractionDigits),
            physicalUsedMin: this.#physical.min,
            physicalUsedMax: this.#physical.max,
            physicalUsedAvg: round(this.#physical.mean, this.#fractionDigits),
            physicalUsedP50: this.#physical.percentile(50),
            physicalUsedP90: this.#physical.percentile(90),
            physicalUsedP95: this.#physical.percentile(95),
            physicalUsedP99: this.#physical.percentile(99),
            heapTotal: latest.heapTotal,
            heapUsed: latest.heapUsed,
            heapUsage: round(latest.heapTotal ? latest.heapUsed / latest.heapTotal * 100 : 0, this.#fractionDigits),
            heapUsedMin: this.#heap.min,
            heapUsedMax: this.#heap.max,
            heapUsedAvg: round(this.#heap.mean, this.#fractionDigits),
            heapUsedP50: this.#heap.percentile(50),
            heapUsedP90: this.#heap.percentile(90),
            heapUsedP95: this.#heap.percentile(95),
            heapUsedP99: this.#heap.percentile(99),
            externalUsed: latest.external,
            externalUsedMin: this.#external.min,
            externalUsedMax: this.#external.max,
            externalUsedAvg: round(this.#external.mean, this.#fractionDigits),
            externalUsedP50: this.#external.percentile(50),
            externalUsedP90: this.#external.percentile(90),
            externalUsedP95: this.#external.percentile(95),
            externalUsedP99: this.#external.percentile(99)
        }
    }

    /**
     * Take a sample of the memory of the process: it becomes the latest usage and is added to the statistics. Called
     * when the monitor is created, then every second.
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
     * Forget the samples: the minimum, maximum, mean and percentiles are 0 until the next sample, then cover the samples
     * taken since. The latest usage is kept.
     */
    public reset(): void {
        this.#physical.reset()
        this.#heap.reset()
        this.#external.reset()
    }
}
