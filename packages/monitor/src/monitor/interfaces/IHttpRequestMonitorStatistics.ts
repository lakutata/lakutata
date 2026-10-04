/**
 * The statistics of an {@link HttpRequestMonitor} since it was created or reset: the number of HTTP requests received
 * and their durations, from their arrival to the end of their response, in milliseconds rounded to 2 decimals. The
 * percentiles are approximate (3 significant digits). All 0 before the first request.
 */
export interface IHttpRequestMonitorStatistics {
    /**
     * The number of requests received whose response ended.
     */
    count: number
    /**
     * The shortest request, in milliseconds.
     */
    min: number
    /**
     * The longest request, in milliseconds.
     */
    max: number
    /**
     * The mean duration, in milliseconds.
     */
    avg: number
    /**
     * The standard deviation of the durations, in milliseconds.
     */
    stdDev: number
    /**
     * The median duration, in milliseconds.
     */
    p50: number
    /**
     * The 90th percentile of the durations (90% of the requests were faster), in milliseconds.
     */
    p90: number
    /**
     * The 95th percentile of the durations, in milliseconds.
     */
    p95: number
    /**
     * The 99th percentile of the durations, in milliseconds.
     */
    p99: number
}