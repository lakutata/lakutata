import {type EventLoopUtilization, type IntervalHistogram, monitorEventLoopDelay, performance} from 'node:perf_hooks'
import {Component} from '@lakutata/core'
import {IEventLoopMonitorStatistics} from './interfaces/IEventLoopMonitorStatistics.js'
import {IMonitor} from './interfaces/IMonitor.js'

/**
 * The delays of the event loop of the process (milliseconds) and its utilization (percent)
 */
export class EventLoopMonitor extends Component implements IMonitor<IEventLoopMonitorStatistics> {

    protected readonly histogram: IntervalHistogram = monitorEventLoopDelay({resolution: 1})

    protected initUtil: EventLoopUtilization = performance.eventLoopUtilization()

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
     * Forget the delays and restart the utilization
     */
    public reset(): void {
        this.histogram.reset()
        this.initUtil = performance.eventLoopUtilization()
    }
}
