/**
 * The statistics of a {@link CpuMonitor}: the CPU usage of the process in percent of one core (100 is one core fully
 * busy; above 100 with several cores busy), each sample the average over one second, rounded to 5 decimals. The
 * minimum, maximum, mean and percentiles cover the samples since the monitor was created or reset; the percentiles are
 * approximate (3 significant digits). All 0 before the first sample.
 */
export interface ICpuMonitorStatistics {
    /**
     * The CPU usage over the latest second (the latest sample), in percent of one core.
     */
    usage: number
    /**
     * The lowest sample, in percent of one core.
     */
    usageMin: number
    /**
     * The highest sample, in percent of one core.
     */
    usageMax: number
    /**
     * The mean of the samples, in percent of one core.
     */
    usageAvg: number
    /**
     * The median sample (50% of the seconds used less), in percent of one core.
     */
    usageP50: number
    /**
     * The 90th percentile of the samples (90% of the seconds used less), in percent of one core.
     */
    usageP90: number
    /**
     * The 95th percentile of the samples, in percent of one core.
     */
    usageP95: number
    /**
     * The 99th percentile of the samples, in percent of one core.
     */
    usageP99: number
}