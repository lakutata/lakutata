import {PerformanceObserver, type PerformanceObserverEntryList} from 'node:perf_hooks'
import {Component} from '@lakutata/core'
import {IMonitor} from './interfaces/IMonitor.js'
import {IHttpRequestMonitorStatistics} from './interfaces/IHttpRequestMonitorStatistics.js'
import {Round, Samples} from './lib/Samples.js'

/**
 * The durations (milliseconds) of the HTTP requests received by the HTTP servers of the process (node:http, so the
 * servers of express and fastify too); the requests sent by the process are not counted
 */
export class HttpRequestMonitor extends Component implements IMonitor<IHttpRequestMonitorStatistics> {

    readonly #fractionDigits: number = 2

    readonly #durations: Samples = new Samples(100)

    protected readonly observer: PerformanceObserver = new PerformanceObserver((list: PerformanceObserverEntryList): void => {
        //Every request of the batch, the received ones only (HttpClient entries are the requests sent)
        for (const entry of list.getEntriesByName('HttpRequest')) this.#durations.record(entry.duration)
    })

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
     * Forget the durations
     */
    public reset(): void {
        this.#durations.reset()
    }
}
