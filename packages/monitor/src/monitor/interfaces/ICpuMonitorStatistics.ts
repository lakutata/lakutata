export interface ICpuMonitorStatistics {
    /**
     * CPU usage rate occupied by the process (%)
     */
    usage: number
    /**
     * Minimum CPU usage rate occupied by the process (%)
     */
    usageMin: number
    /**
     * Maximum CPU usage rate occupied by the process (%)
     */
    usageMax: number
    /**
     * Average CPU usage rate occupied by the process (%)
     */
    usageAvg: number
    /**
     * P50 of CPU usage rate occupied by the process (%)
     */
    usageP50: number
    /**
     * P90 of CPU usage rate occupied by the process (%)
     */
    usageP90: number
    /**
     * P95 of CPU usage rate occupied by the process (%)
     */
    usageP95: number
    /**
     * P99 of CPU usage rate occupied by the process (%)
     */
    usageP99: number
}