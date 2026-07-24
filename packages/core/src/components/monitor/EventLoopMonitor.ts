import {EventLoopUtilization, IntervalHistogram, monitorEventLoopDelay, performance} from 'node:perf_hooks'
import {IEventLoopMonitorStatistics} from './interfaces/IEventLoopMonitorStatistics.js'
import {IMonitor} from './interfaces/IMonitor.js'
import {Component} from '../../lib/core/Component.js'

export class EventLoopMonitor extends Component implements IMonitor<IEventLoopMonitorStatistics> {

    protected readonly histogram: IntervalHistogram = monitorEventLoopDelay({resolution: 1})

    protected initUtil: EventLoopUtilization = performance.eventLoopUtilization()

    public get statistics(): IEventLoopMonitorStatistics {
        return {
            min: this.histogram.min / 1e6,
            max: this.histogram.max / 1e6,
            avg: this.histogram.mean / 1e6,
            stdDev: this.histogram.stddev / 1e6,
            p50: this.histogram.percentile(50) / 1e6,
            p90: this.histogram.percentile(90) / 1e6,
            p95: this.histogram.percentile(95) / 1e6,
            p99: this.histogram.percentile(99) / 1e6,
            utilRate: performance.eventLoopUtilization(this.initUtil).utilization * 100
        }
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.histogram.enable()
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.histogram.disable()
    }

    /**
     * Reset statistics
     */
    public reset(): void {
        this.histogram.reset()
        this.initUtil = performance.eventLoopUtilization()
    }
}