export interface IHttpRequestMonitorStatistics {
    /**
     * Minimum HTTP request duration (ms)
     */
    min: number
    /**
     * Maximum HTTP request duration (ms)
     */
    max: number
    /**
     * Average HTTP request duration (ms)
     */
    avg: number
    /**
     * Standard deviation of HTTP request duration (ms)
     */
    stdDev: number
    /**
     * P50 of HTTP request duration (ms)
     */
    p50: number
    /**
     * P90 of HTTP request duration (ms)
     */
    p90: number
    /**
     * P95 of HTTP request duration (ms)
     */
    p95: number
    /**
     * P99 of HTTP request duration (ms)
     */
    p99: number
}