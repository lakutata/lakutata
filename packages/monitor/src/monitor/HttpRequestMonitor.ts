import {PerformanceObserver, type PerformanceObserverEntryList} from 'node:perf_hooks'
import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {IHttpRequestMonitorStatistics} from './interfaces/IHttpRequestMonitorStatistics.js'
import {Round, Samples} from './lib/Samples.js'

/**
 * The HTTP request monitor: measures how long the HTTP requests received by the process take, in milliseconds, from
 * their arrival to the end of their response, through the performance entries of `node:http` (so every server built on
 * it is counted: the Express and Fastify adapters, and any other server of the process). The requests the process
 * sends are not counted, nor are HTTP/2 requests.
 *
 * It keeps the count and the statistics of the durations since it was created or last {@link HttpRequestMonitor.reset},
 * in constant memory. The entries reach it in batches, shortly after the responses end, so a request just answered may
 * not be counted yet. Declare it in the `components` of the application (`{class: HttpRequestMonitor}`) and get it with
 * `@Inject` or `getObject()`; it is a singleton. It only sees the requests ending after its creation: list it in
 * `bootstrap` to measure from the launch; it stops when the component is destroyed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {HttpRequestMonitor, type IHttpRequestMonitorStatistics} from 'lakutata/com/monitor'
 *
 * Application
 *     .run(() => ({
 *         id: 'http.app',
 *         name: 'Http',
 *         components: {
 *             httpRequests: {class: HttpRequestMonitor}
 *         },
 *         bootstrap: ['httpRequests']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const httpRequests: HttpRequestMonitor = await app.getObject('httpRequests')
 *         setInterval((): void => {
 *             const statistics: IHttpRequestMonitorStatistics = httpRequests.statistics
 *             console.log(`${statistics.count} requests, avg ${statistics.avg} ms, p99 ${statistics.p99} ms`)
 *             httpRequests.reset()
 *         }, 60000)
 *     })
 * ```
 */
export class HttpRequestMonitor extends Component implements IMonitor<IHttpRequestMonitorStatistics> {

    readonly #fractionDigits: number = 2

    readonly #durations: Samples = new Samples(100)

    /**
     * The observer of the `http` performance entries, recording the duration of each received request (the
     * `HttpRequest` entries); observing from the monitor's initialization to its destruction.
     */
    protected readonly observer: PerformanceObserver = new PerformanceObserver((list: PerformanceObserverEntryList): void => {
        //Every request of the batch, the received ones only (HttpClient entries are the requests sent)
        for (const entry of list.getEntriesByName('HttpRequest')) this.#durations.record(entry.duration)
    })

    /**
     * The statistics of the request durations since the monitor was created or reset, computed at each read: the
     * number of requests, and the minimum, maximum, mean, standard deviation and percentiles of their durations in
     * milliseconds, rounded to 2 decimals. The percentiles are approximate (3 significant digits). All 0 before the first
     * request.
     */
    public get statistics(): IHttpRequestMonitorStatistics {
        return {
            count: this.#durations.count,
            min: Round(this.#durations.min, this.#fractionDigits),
            max: Round(this.#durations.max, this.#fractionDigits),
            avg: Round(this.#durations.mean, this.#fractionDigits),
            stdDev: Round(this.#durations.stdDev, this.#fractionDigits),
            p50: Round(this.#durations.percentile(50), this.#fractionDigits),
            p90: Round(this.#durations.percentile(90), this.#fractionDigits),
            p95: Round(this.#durations.percentile(95), this.#fractionDigits),
            p99: Round(this.#durations.percentile(99), this.#fractionDigits)
        }
    }

    protected async init(): Promise<void> {
        this.observer.observe({entryTypes: ['http']})
    }

    protected async destroy(): Promise<void> {
        this.observer.disconnect()
    }

    /**
     * Forget the requests: the count and the statistics restart from 0. Use it to measure a period, such as between
     * two reports.
     */
    public reset(): void {
        this.#durations.reset()
    }
}
