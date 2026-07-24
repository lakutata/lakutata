import {PerformanceEntry, PerformanceObserver, PerformanceObserverEntryList} from 'node:perf_hooks'
import {quantile, average, standardDeviation} from 'simple-statistics'
import {IMonitor} from './interfaces/IMonitor.js'
import {IHttpRequestMonitorStatistics} from './interfaces/IHttpRequestMonitorStatistics.js'
import {Component} from '../../lib/core/Component.js'

export class HttpRequestMonitor extends Component implements IMonitor<IHttpRequestMonitorStatistics> {

    readonly #fractionDigits: number = 2

    readonly #durationRecordLimit: number = 65535

    #min: number = 0

    #max: number = 0

    #durations: number[] = []

    protected readonly observer: PerformanceObserver = new PerformanceObserver((list: PerformanceObserverEntryList): void => {
        const entry: PerformanceEntry = list.getEntries()[0]
        const duration: number = parseFloat(entry.duration.toFixed(this.#fractionDigits))
        this.#durations.push(duration)
        if (this.#durations.length > this.#durationRecordLimit) this.#durations.shift()
        if (!this.#min) this.#min = duration
        this.#min = this.#min > duration ? duration : this.#min
        if (!this.#max) this.#max = duration
        this.#max = this.#max < duration ? duration : this.#max
    })

    public get statistics(): IHttpRequestMonitorStatistics {
        return {
            min: this.#min,
            max: this.#max,
            avg: parseFloat((this.#durations.length ? average(this.#durations) : 0).toFixed(this.#fractionDigits)),
            stdDev: parseFloat((this.#durations.length ? standardDeviation(this.#durations) : 0).toFixed(this.#fractionDigits)),
            p50: parseFloat((this.#durations.length ? quantile(this.#durations, 0.50) : 0).toFixed(this.#fractionDigits)),
            p90: parseFloat((this.#durations.length ? quantile(this.#durations, 0.90) : 0).toFixed(this.#fractionDigits)),
            p95: parseFloat((this.#durations.length ? quantile(this.#durations, 0.95) : 0).toFixed(this.#fractionDigits)),
            p99: parseFloat((this.#durations.length ? quantile(this.#durations, 0.99) : 0).toFixed(this.#fractionDigits))
        }
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.observer.observe({entryTypes: ['http']})
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.observer.disconnect()
    }

    /**
     * Reset statistics
     */
    public reset(): void {
        this.#min = 0
        this.#max = 0
        this.#durations = []
    }
}