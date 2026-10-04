/**
 * A Windows container's disk I/O counters ({@link ContainerStats.storage_stats}).
 */
export type ContainerStorageStats = {
    /**
     * The number of read operations.
     */
    read_count_normalized?: number
    /**
     * The bytes read.
     */
    read_size_bytes?: number
    /**
     * The number of write operations.
     */
    write_count_normalized?: number
    /**
     * The bytes written.
     */
    write_size_bytes?: number
}

/**
 * A container's network counters, by the name of its network interface in the container (`eth0`), counted since the
 * interface was created ({@link ContainerStats.networks}).
 */
export type ContainerNetworkStats = {
    [name: string]: {
        /**
         * The bytes received.
         */
        rx_bytes: number
        /**
         * The received packets dropped.
         */
        rx_dropped: number
        /**
         * The receive errors.
         */
        rx_errors: number
        /**
         * The packets received.
         */
        rx_packets: number
        /**
         * The bytes sent.
         */
        tx_bytes: number
        /**
         * The packets dropped while sending.
         */
        tx_dropped: number
        /**
         * The send errors.
         */
        tx_errors: number
        /**
         * The packets sent.
         */
        tx_packets: number
        /**
         * The endpoint ID, on Windows only.
         */
        endpoint_id?: string // not used on linux
        /**
         * The instance ID, on Windows only.
         */
        instance_id?: string // not used on linux
    }
}

/**
 * A container's memory use ({@link ContainerStats.memory_stats}). The Linux fields are the ones of cgroup v1: on a host
 * using cgroup v2 (most current distributions), `max_usage` and `failcnt` are absent, and `stats` holds the cgroup v2
 * counters (`anon`, `file`, `inactive_file`…) instead of the ones listed here.
 */
export type ContainerMemoryStats = {
    // Linux Memory Stats
    /**
     * The cgroup's memory counters (its `memory.stat` file): the sizes in bytes, the page fault and page in/out counters
     * in events; the `total_` fields include the child cgroups.
     */
    stats: {
        /**
         * The major page faults, child cgroups included.
         */
        total_pgmajfault: number
        /**
         * The page cache, in bytes.
         */
        cache: number
        /**
         * The memory-mapped files, in bytes.
         */
        mapped_file: number
        /**
         * The inactive file-backed memory, in bytes, child cgroups included.
         */
        total_inactive_file: number
        /**
         * The pages paged out.
         */
        pgpgout: number
        /**
         * The anonymous memory and swap cache (RSS), in bytes.
         */
        rss: number
        /**
         * The memory-mapped files, in bytes, child cgroups included.
         */
        total_mapped_file: number
        /**
         * The file pages being written back to disk, in bytes.
         */
        writeback: number
        /**
         * The memory which cannot be reclaimed (locked), in bytes.
         */
        unevictable: number
        /**
         * The pages paged in.
         */
        pgpgin: number
        /**
         * The memory which cannot be reclaimed, in bytes, child cgroups included.
         */
        total_unevictable: number
        /**
         * The major page faults.
         */
        pgmajfault: number
        /**
         * The RSS, in bytes, child cgroups included.
         */
        total_rss: number
        /**
         * The anonymous transparent huge pages, in bytes, child cgroups included.
         */
        total_rss_huge: number
        /**
         * The file pages being written back to disk, in bytes, child cgroups included.
         */
        total_writeback: number
        /**
         * The inactive anonymous memory, in bytes, child cgroups included.
         */
        total_inactive_anon: number
        /**
         * The anonymous transparent huge pages, in bytes.
         */
        rss_huge: number
        /**
         * The memory limit of the cgroup hierarchy, in bytes.
         */
        hierarchical_memory_limit: number
        /**
         * The page faults, child cgroups included.
         */
        total_pgfault: number
        /**
         * The active file-backed memory, in bytes, child cgroups included.
         */
        total_active_file: number
        /**
         * The active anonymous memory, in bytes.
         */
        active_anon: number
        /**
         * The active anonymous memory, in bytes, child cgroups included.
         */
        total_active_anon: number
        /**
         * The pages paged out, child cgroups included.
         */
        total_pgpgout: number
        /**
         * The page cache, in bytes, child cgroups included.
         */
        total_cache: number
        /**
         * The inactive anonymous memory, in bytes.
         */
        inactive_anon: number
        /**
         * The active file-backed memory, in bytes.
         */
        active_file: number
        /**
         * The page faults.
         */
        pgfault: number
        /**
         * The inactive file-backed memory, in bytes.
         */
        inactive_file: number
        /**
         * The pages paged in, child cgroups included.
         */
        total_pgpgin: number
    }
    /**
     * The highest memory use recorded, in bytes (cgroup v1 only).
     */
    max_usage: number
    /**
     * The current memory use, in bytes, page cache included (`docker stats` subtracts the inactive files from it).
     */
    usage: number
    /**
     * The number of times the memory use hit the limit (cgroup v1 only).
     */
    failcnt: number
    /**
     * The memory limit, in bytes: the host memory when the container has no limit.
     */
    limit: number

    // Windows Memory Stats
    /**
     * The committed memory, in bytes (Windows only).
     */
    commitbytes?: number
    /**
     * The highest committed memory, in bytes (Windows only).
     */
    commitpeakbytes?: number
    /**
     * The private working set, in bytes (Windows only).
     */
    privateworkingset?: number
}

/**
 * A container's cumulated CPU time ({@link ContainerCPUStats.cpu_usage}), in nanoseconds on Linux and in 100-nanosecond
 * units on Windows.
 */
export type ContainerCPUUsage = {
    /**
     * The CPU time per host CPU (cgroup v1 only: absent on a host using cgroup v2).
     */
    percpu_usage: number[]
    /**
     * The CPU time spent in user mode.
     */
    usage_in_usermode: number
    /**
     * The total CPU time.
     */
    total_usage: number
    /**
     * The CPU time spent in kernel mode.
     */
    usage_in_kernelmode: number
}

/**
 * How a container with a CPU limit was throttled ({@link ContainerCPUStats.throttling_data}), since it started.
 */
export type ContainerThrottlingData = {
    /**
     * The number of enforcement periods elapsed.
     */
    periods: number
    /**
     * The number of periods in which the container was throttled.
     */
    throttled_periods: number
    /**
     * The total time the container was throttled, in nanoseconds.
     */
    throttled_time: number
}

/**
 * A container's CPU use at one moment ({@link ContainerStats.cpu_stats}). The CPU percentage of `docker stats` is the
 * growth of `cpu_usage.total_usage` divided by the growth of `system_cpu_usage` between two readings, multiplied by
 * `online_cpus` and 100.
 */
export type  ContainerCPUStats = {
    /**
     * The container's cumulated CPU time.
     */
    cpu_usage: ContainerCPUUsage
    /**
     * The host's cumulated CPU time, all CPUs added, in nanoseconds (Linux only).
     */
    system_cpu_usage: number
    /**
     * The number of host CPUs online.
     */
    online_cpus: number
    /**
     * How the container was throttled by its CPU limit.
     */
    throttling_data: ContainerThrottlingData
}

/**
 * A block I/O counter of one device ({@link ContainerBlkioStats}).
 */
export type ContainerBlkioStatEntry = {
    /**
     * The device's major number.
     */
    major: number
    /**
     * The device's minor number.
     */
    minor: number
    /**
     * The operation counted: `read`, `write` (`Read`, `Write`, `Sync`, `Async`, `Discard`, `Total` on cgroup v1).
     */
    op: string
    /**
     * The counter's value, in the unit of its list.
     */
    value: number
}

/**
 * A Linux container's block I/O counters, by device and operation ({@link ContainerStats.blkio_stats}). On a host using
 * cgroup v2, only `io_service_bytes_recursive` and `io_serviced_recursive` are filled: Docker reports `null` for the
 * other lists.
 */
export type ContainerBlkioStats = {
    /**
     * The bytes transferred.
     */
    io_service_bytes_recursive: ContainerBlkioStatEntry[]
    /**
     * The number of I/O operations.
     */
    io_serviced_recursive: ContainerBlkioStatEntry[]
    /**
     * The number of I/O operations queued (cgroup v1 only).
     */
    io_queue_recursive: ContainerBlkioStatEntry[]
    /**
     * The time spent servicing the I/O operations, in nanoseconds (cgroup v1 only).
     */
    io_service_time_recursive: ContainerBlkioStatEntry[]
    /**
     * The time the I/O operations waited in the queues, in nanoseconds (cgroup v1 only).
     */
    io_wait_time_recursive: ContainerBlkioStatEntry[]
    /**
     * The number of I/O operations merged into others (cgroup v1 only).
     */
    io_merged_recursive: ContainerBlkioStatEntry[]
    /**
     * The disk time allocated to the container, in milliseconds (cgroup v1 only).
     */
    io_time_recursive: ContainerBlkioStatEntry[]
    /**
     * The sectors transferred (cgroup v1 only).
     */
    sectors_recursive: ContainerBlkioStatEntry[]
}

/**
 * The processes of a Linux container ({@link ContainerStats.pids_stats}).
 */
export type ContainerPidsStats = {
    /**
     * The number of processes and threads in the container.
     */
    current?: number
    /**
     * The maximum number of processes and threads (`docker run --pids-limit`); absent, or `0`, without a limit.
     */
    limit?: number
}

/**
 * A container's resource use at one moment, as the Docker Engine reports it (`GET /containers/{id}/stats`), returned by
 * `DockerContainer.stats()`. The statistics are read once, without waiting for a second sample: `precpu_stats` is
 * empty (its counters `0`) and `preread` is the zero date, so a CPU percentage needs two calls, compared.
 */
export type ContainerStats = {
    /**
     * When the statistics were read, an RFC 3339 date with nanoseconds (`2026-10-04T08:15:30.123456789Z`).
     */
    read: string
    /**
     * When the previous statistics were read: the zero date (`0001-01-01T00:00:00Z`), as they are read once.
     */
    preread: string
    /**
     * The container's processes (Linux only).
     */
    pids_stats?: ContainerPidsStats
    /**
     * The container's block I/O (Linux only).
     */
    blkio_stats?: ContainerBlkioStats
    /**
     * The number of processes (Windows only: `0` on Linux).
     */
    num_procs: number
    /**
     * The container's disk I/O (Windows only).
     */
    storage_stats?: ContainerStorageStats
    /**
     * The container's network counters, by interface. Docker omits them for a container without a network (`none`).
     */
    networks: ContainerNetworkStats
    /**
     * The container's memory use.
     */
    memory_stats: ContainerMemoryStats
    /**
     * The container's CPU use.
     */
    cpu_stats: ContainerCPUStats
    /**
     * The CPU use of the previous reading: its counters are `0`, as the statistics are read once.
     */
    precpu_stats: ContainerCPUStats
}
