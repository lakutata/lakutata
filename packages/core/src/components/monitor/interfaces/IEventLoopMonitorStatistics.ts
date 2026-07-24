export interface IEventLoopMonitorStatistics {
    /**
     * Minimum event loop delay (ms)
     */
    min: number
    /**
     * Maximum event loop delay (ms)
     */
    max: number
    /**
     * Average event loop delay (ms)
     */
    avg: number
    /**
     * Standard deviation of event loop delay (ms)
     */
    stdDev: number
    /**
     * P50 of event loop delay (ms)
     */
    p50: number
    /**
     * P90 of event loop delay (ms)
     */
    p90: number
    /**
     * P95 of event loop delay (ms)
     */
    p95: number
    /**
     * P99 of event loop delay (ms)
     */
    p99: number
    /**
     * Event loop utilization rate (%)
     */
    utilRate: number
}