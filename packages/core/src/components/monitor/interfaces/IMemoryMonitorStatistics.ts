export interface IMemoryMonitorStatistics {
    /**
     * Total physical memory (Bytes)
     */
    physicalTotal: number
    /**
     * Physical memory usage by the process (Bytes)
     */
    physicalUsed: number
    /**
     * Physical memory usage percentage by the process (%)
     */
    physicalUsage: number
    /**
     * Minimum physical memory usage by the process (Bytes)
     */
    physicalUsedMin: number
    /**
     * Maximum physical memory usage by the process (Bytes)
     */
    physicalUsedMax: number
    /**
     * Average physical memory usage by the process (Bytes)
     */
    physicalUsedAvg: number
    /**
     * P50 of physical memory usage by the process (Bytes)
     */
    physicalUsedP50: number
    /**
     * P90 of physical memory usage by the process (Bytes)
     */
    physicalUsedP90: number
    /**
     * P95 of physical memory usage by the process (Bytes)
     */
    physicalUsedP95: number
    /**
     * P99 of physical memory usage by the process (Bytes)
     */
    physicalUsedP99: number
    /**
     * Total heap memory allocated for JS objects (Bytes)
     */
    heapTotal: number
    /**
     * Used portion of heap memory (Bytes)
     */
    heapUsed: number
    /**
     * Percentage of used heap memory (%)
     */
    heapUsage: number
    /**
     * Minimum used portion of heap memory (Bytes)
     */
    heapUsedMin: number
    /**
     * Maximum used portion of heap memory (Bytes)
     */
    heapUsedMax: number
    /**
     * Average used portion of heap memory (Bytes)
     */
    heapUsedAvg: number
    /**
     * P50 of used portion of heap memory (Bytes)
     */
    heapUsedP50: number
    /**
     * P90 of used portion of heap memory (Bytes)
     */
    heapUsedP90: number
    /**
     * P95 of used portion of heap memory (Bytes)
     */
    heapUsedP95: number
    /**
     * P99 of used portion of heap memory (Bytes)
     */
    heapUsedP99: number
    /**
     * Memory occupied by C++ objects (Bytes)
     */
    externalUsed: number
    /**
     * Minimum memory occupied by C++ objects (Bytes)
     */
    externalUsedMin: number
    /**
     * Maximum memory occupied by C++ objects (Bytes)
     */
    externalUsedMax: number
    /**
     * Average memory occupied by C++ objects (Bytes)
     */
    externalUsedAvg: number
    /**
     * P50 of memory occupied by C++ objects (Bytes)
     */
    externalUsedP50: number
    /**
     * P90 of memory occupied by C++ objects (Bytes)
     */
    externalUsedP90: number
    /**
     * P95 of memory occupied by C++ objects (Bytes)
     */
    externalUsedP95: number
    /**
     * P99 of memory occupied by C++ objects (Bytes)
     */
    externalUsedP99: number
}