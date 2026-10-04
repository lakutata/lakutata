/**
 * The statistics of an {@link EventLoopMonitor} since it was created or reset: the event loop delays, in milliseconds
 * (measured by a timer due every millisecond: about 1 ms when the loop is idle, more while synchronous work blocks
 * it; all 0 before the first measure), and the loop utilization, in percent. The percentiles
 * come from Node's histogram.
 */
export interface IEventLoopMonitorStatistics {
    /**
     * The shortest delay, in milliseconds.
     */
    min: number
    /**
     * The longest delay, in milliseconds: the longest the loop was blocked.
     */
    max: number
    /**
     * The mean delay, in milliseconds.
     */
    avg: number
    /**
     * The standard deviation of the delays, in milliseconds.
     */
    stdDev: number
    /**
     * The median delay, in milliseconds.
     */
    p50: number
    /**
     * The 90th percentile of the delays (90% were shorter), in milliseconds.
     */
    p90: number
    /**
     * The 95th percentile of the delays, in milliseconds.
     */
    p95: number
    /**
     * The 99th percentile of the delays, in milliseconds: the usual pick for an alert.
     */
    p99: number
    /**
     * The share of the time the event loop was busy running code rather than waiting for I/O, in percent (0 to
     * 100), since the monitor was created or reset. Not rounded.
     */
    utilRate: number
}