export type ContainerdContainerStats = {
    read: Date
    pids: { current: number, limit: number }
    cpu: {
        /**
         * Its time on the CPUs in nanoseconds, in the user mode and in the kernel mode
         */
        usage: number
        user: number
        system: number
        throttledPeriods: number
        throttledTime: number
        onlineCpus: number
        /**
         * Its use of the CPUs during the interval of the sampling (100: one CPU used all the time)
         */
        percent: number
    }
    memory: {
        usage: number
        /**
         * Its usage without the cache which can be freed (the one of docker stats)
         */
        workingSet: number
        limit: number
        cache: number
        swap: number
        oomKills: number
    }
    blkio: { readBytes: number, writeBytes: number, readOps: number, writeOps: number }
    networks: Record<string, { rxBytes: number, rxPackets: number, rxErrors: number, rxDropped: number, txBytes: number, txPackets: number, txErrors: number, txDropped: number }>
}
