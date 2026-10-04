/**
 * The statistics of a {@link MemoryMonitor}, in bytes unless stated: the latest sample of the process memory
 * (`process.memoryUsage()`), and the minimum, maximum, mean and percentiles of the samples taken every second since
 * the monitor was created or reset (0 after a reset until the next sample). The percentiles are approximate (3
 * significant digits).
 */
export interface IMemoryMonitorStatistics {
    /**
     * The total physical memory of the host (`os.totalmem()`), in bytes; under a container, the host's,
     * not the container's limit.
     */
    physicalTotal: number
    /**
     * The resident set size of the process (`rss`) at the latest sample: the physical memory it occupies, in
     * bytes.
     */
    physicalUsed: number
    /**
     * `physicalUsed` as a percentage of `physicalTotal`, rounded to 2 decimals.
     */
    physicalUsage: number
    /**
     * The lowest resident set size sampled, in bytes.
     */
    physicalUsedMin: number
    /**
     * The highest resident set size sampled, in bytes.
     */
    physicalUsedMax: number
    /**
     * The mean resident set size of the samples, in bytes, rounded to 2 decimals.
     */
    physicalUsedAvg: number
    /**
     * The median resident set size of the samples, in bytes.
     */
    physicalUsedP50: number
    /**
     * The 90th percentile of the resident set size samples, in bytes.
     */
    physicalUsedP90: number
    /**
     * The 95th percentile of the resident set size samples, in bytes.
     */
    physicalUsedP95: number
    /**
     * The 99th percentile of the resident set size samples, in bytes.
     */
    physicalUsedP99: number
    /**
     * The size of the V8 heap reserved by the process at the latest sample, in bytes.
     */
    heapTotal: number
    /**
     * The part of the V8 heap occupied by JavaScript objects at the latest sample, in bytes.
     */
    heapUsed: number
    /**
     * `heapUsed` as a percentage of `heapTotal`, rounded to 2 decimals. V8 grows the heap as needed, so a
     * high value alone is not a leak: a leak shows as `heapUsedMin` rising from one reset period to the next.
     */
    heapUsage: number
    /**
     * The lowest used heap sampled, in bytes.
     */
    heapUsedMin: number
    /**
     * The highest used heap sampled, in bytes.
     */
    heapUsedMax: number
    /**
     * The mean used heap of the samples, in bytes, rounded to 2 decimals.
     */
    heapUsedAvg: number
    /**
     * The median used heap of the samples, in bytes.
     */
    heapUsedP50: number
    /**
     * The 90th percentile of the used heap samples, in bytes.
     */
    heapUsedP90: number
    /**
     * The 95th percentile of the used heap samples, in bytes.
     */
    heapUsedP95: number
    /**
     * The 99th percentile of the used heap samples, in bytes.
     */
    heapUsedP99: number
    /**
     * The memory of the C++ objects bound to JavaScript objects (the `Buffer`s included) at the latest
     * sample, in bytes.
     */
    externalUsed: number
    /**
     * The lowest external memory sampled, in bytes.
     */
    externalUsedMin: number
    /**
     * The highest external memory sampled, in bytes.
     */
    externalUsedMax: number
    /**
     * The mean external memory of the samples, in bytes, rounded to 2 decimals.
     */
    externalUsedAvg: number
    /**
     * The median external memory of the samples, in bytes.
     */
    externalUsedP50: number
    /**
     * The 90th percentile of the external memory samples, in bytes.
     */
    externalUsedP90: number
    /**
     * The 95th percentile of the external memory samples, in bytes.
     */
    externalUsedP95: number
    /**
     * The 99th percentile of the external memory samples, in bytes.
     */
    externalUsedP99: number
}