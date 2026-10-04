/**
 * The resources a running (or paused) container uses ({@link ContainerdContainer.stats}): its cgroup counters (cgroup
 * v1 or v2), read twice an interval apart to compute its CPU use, and its network interface counters. The counters are
 * cumulative since the container started, except `cpu.percent`.
 */
export type ContainerdContainerStats = {
    /**
     * When the last sample was read.
     */
    read: Date
    /**
     * Its processes: `current`, the processes (and threads) it has; `limit`, the most it may have, `0` when it has no
     * limit.
     */
    pids: { current: number, limit: number }
    /**
     * Its CPU use; the times are in nanoseconds.
     */
    cpu: {
        /**
         * Its total CPU time in nanoseconds, in user mode and in kernel mode.
         */
        usage: number
        /**
         * Its CPU time in user mode, in nanoseconds.
         */
        user: number
        /**
         * Its CPU time in kernel mode, in nanoseconds.
         */
        system: number
        /**
         * The CFS periods it was throttled in (by its `cpus` limit).
         */
        throttledPeriods: number
        /**
         * The time it was throttled, in nanoseconds.
         */
        throttledTime: number
        /**
         * The CPUs of the host (on cgroup v1, the ones its cgroup reports).
         */
        onlineCpus: number
        /**
         * Its CPU use during the sampling interval, in percent of one CPU: `100` is one CPU used all the time, `200`
         * two of them. `0` when the interval is `0`.
         */
        percent: number
    }
    /**
     * Its memory use, in bytes.
     */
    memory: {
        /**
         * The memory it uses, page cache included, in bytes.
         */
        usage: number
        /**
         * Its usage without the inactive page cache the kernel can reclaim, in bytes (the figure `docker stats`
         * shows).
         */
        workingSet: number
        /**
         * Its memory limit in bytes; the host's total memory when it has none.
         */
        limit: number
        /**
         * Its page cache (file-backed memory), in bytes.
         */
        cache: number
        /**
         * The swap it uses, in bytes.
         */
        swap: number
        /**
         * How many times the kernel's OOM killer killed one of its processes.
         */
        oomKills: number
    }
    /**
     * Its block device I/O, summed over the devices: the bytes read and written, the read and write operations.
     */
    blkio: { readBytes: number, writeBytes: number, readOps: number, writeOps: number }
    /**
     * The counters of its network interfaces by name (`eth0`), loopback excluded: the bytes, packets, errors and
     * dropped packets received (`rx…`) and sent (`tx…`). On the host network, they are the host's interfaces; empty
     * when its process is gone.
     */
    networks: Record<string, { rxBytes: number, rxPackets: number, rxErrors: number, rxDropped: number, txBytes: number, txPackets: number, txErrors: number, txDropped: number }>
}
