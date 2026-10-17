import {type EventLoopUtilization, type IntervalHistogram, monitorEventLoopDelay, performance} from 'node:perf_hooks'
import {Component} from '@lakutata/core'
import {IEventLoopMonitorStatistics} from './interfaces/IEventLoopMonitorStatistics.js'
import {IMonitor} from './interfaces/IMonitor.js'

/**
 * The event loop monitor: measures the event loop of the thread that creates it, the main thread or a worker: the
 * intervals between the runs of a 1 ms timer (the event loop delay, in milliseconds, with Node's
 * `monitorEventLoopDelay` at a 1 ms resolution: about 1 ms when the loop is idle) and how busy the loop is (its
 * utilization, in percent of the time). A growing delay means synchronous work (CPU-bound code, synchronous I/O, large
 * JSON) blocks the other requests; a utilization near 100 means the loop has no idle time left. The 1 ms timer costs
 * about 1.5 % of a core.
 *
 * Both cover the time since the monitor was created or last {@link EventLoopMonitor.reset}: the delays are a histogram
 * of every measure (its minimum, maximum and mean are those of the histogram, not exact), the utilization is the share
 * of that whole time the loop was busy (100 right after a reset, the loop busy running the code that calls it). Declare
 * it in the `components` of the application (`{class: EventLoopMonitor}`) and get it with `@Inject` or `getObject()`;
 * it is a singleton. It starts measuring when it is created: list it in `bootstrap` to measure from the launch; it
 * stops when the component is destroyed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {EventLoopMonitor, type IEventLoopMonitorStatistics} from 'lakutata/com/monitor'
 *
 * Application
 *     .run(() => ({
 *         id: 'loop.app',
 *         name: 'Loop',
 *         components: {
 *             eventLoop: {class: EventLoopMonitor}
 *         },
 *         bootstrap: ['eventLoop']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const eventLoop: EventLoopMonitor = await app.getObject('eventLoop')
 *         setInterval((): void => {
 *             const statistics: IEventLoopMonitorStatistics = eventLoop.statistics
 *             if (statistics.p99 > 100) console.log(`The event loop lags: p99 ${statistics.p99} ms, ${statistics.utilRate}% busy`)
 *             //Each report covers the last minute
 *             eventLoop.reset()
 *         }, 60000)
 *     })
 * ```
 */
export class EventLoopMonitor extends Component implements IMonitor<IEventLoopMonitorStatistics> {

    /**
     * The histogram of the event loop delays, in nanoseconds, sampled every millisecond while enabled (from the
     * monitor's initialization to its destruction).
     */
    protected readonly histogram: IntervalHistogram = monitorEventLoopDelay({resolution: 1})

    /**
     * The event loop utilization when the monitor was created or reset: the start of the period that
     * {@link IEventLoopMonitorStatistics.utilRate} covers.
     */
    protected initUtil: EventLoopUtilization = performance.eventLoopUtilization()

    /**
     * The event loop statistics since the monitor was created or reset, computed at each read: the minimum, maximum,
     * mean, standard deviation and percentiles of the delays in milliseconds (not rounded; all 0 before the first
     * measure), and the utilization in percent.
     */
    public get statistics(): IEventLoopMonitorStatistics {
        //Without sample yet, the histogram gives no meaningful value
        const sampled: boolean = this.histogram.count > 0
        const delay = (nanoseconds: number): number => sampled ? nanoseconds / 1e6 : 0
        return {
            min: delay(this.histogram.min),
            max: delay(this.histogram.max),
            avg: delay(this.histogram.mean),
            stdDev: delay(this.histogram.stddev),
            p50: delay(this.histogram.percentile(50)),
            p90: delay(this.histogram.percentile(90)),
            p95: delay(this.histogram.percentile(95)),
            p99: delay(this.histogram.percentile(99)),
            utilRate: performance.eventLoopUtilization(this.initUtil).utilization * 100
        }
    }

    protected async init(): Promise<void> {
        this.histogram.enable()
    }

    protected async destroy(): Promise<void> {
        this.histogram.disable()
    }

    /**
     * Forget the delays and restart the utilization: the statistics then cover the time since this call. Use it to
     * measure a period, such as between two reports.
     */
    public reset(): void {
        this.histogram.reset()
        this.initUtil = performance.eventLoopUtilization()
    }
}
