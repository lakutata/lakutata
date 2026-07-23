export type ContainerStorageStats = {
    read_count_normalized?: number;
    read_size_bytes?: number;
    write_count_normalized?: number;
    write_size_bytes?: number;
}

export type ContainerNetworkStats = {
    [name: string]: {
        rx_bytes: number
        rx_dropped: number
        rx_errors: number
        rx_packets: number
        tx_bytes: number
        tx_dropped: number
        tx_errors: number
        tx_packets: number
        endpoint_id?: string // not used on linux
        instance_id?: string // not used on linux
    }
}

export type ContainerMemoryStats = {
    // Linux Memory Stats
    stats: {
        total_pgmajfault: number
        cache: number
        mapped_file: number
        total_inactive_file: number
        pgpgout: number
        rss: number
        total_mapped_file: number
        writeback: number
        unevictable: number
        pgpgin: number
        total_unevictable: number
        pgmajfault: number
        total_rss: number
        total_rss_huge: number
        total_writeback: number
        total_inactive_anon: number
        rss_huge: number
        hierarchical_memory_limit: number
        total_pgfault: number
        total_active_file: number
        active_anon: number
        total_active_anon: number
        total_pgpgout: number
        total_cache: number
        inactive_anon: number
        active_file: number
        pgfault: number
        inactive_file: number
        total_pgpgin: number
    };
    max_usage: number
    usage: number
    failcnt: number
    limit: number

    // Windows Memory Stats
    commitbytes?: number
    commitpeakbytes?: number
    privateworkingset?: number
}

export type ContainerCPUUsage = {
    percpu_usage: number[]
    usage_in_usermode: number
    total_usage: number
    usage_in_kernelmode: number
}

export type ContainerThrottlingData = {
    periods: number
    throttled_periods: number
    throttled_time: number
}

export type  ContainerCPUStats = {
    cpu_usage: ContainerCPUUsage
    system_cpu_usage: number
    online_cpus: number
    throttling_data: ContainerThrottlingData
}

export type ContainerBlkioStatEntry = {
    major: number
    minor: number
    op: string
    value: number
}

export type ContainerBlkioStats = {
    io_service_bytes_recursive: ContainerBlkioStatEntry[]
    io_serviced_recursive: ContainerBlkioStatEntry[]
    io_queue_recursive: ContainerBlkioStatEntry[]
    io_service_time_recursive: ContainerBlkioStatEntry[]
    io_wait_time_recursive: ContainerBlkioStatEntry[]
    io_merged_recursive: ContainerBlkioStatEntry[]
    io_time_recursive: ContainerBlkioStatEntry[]
    sectors_recursive: ContainerBlkioStatEntry[]
}

export type ContainerPidsStats = {
    current?: number
    limit?: number
}

export type ContainerStats = {
    read: string
    preread: string
    pids_stats?: ContainerPidsStats
    blkio_stats?: ContainerBlkioStats
    num_procs: number
    storage_stats?: ContainerStorageStats
    networks: ContainerNetworkStats
    memory_stats: ContainerMemoryStats
    cpu_stats: ContainerCPUStats
    precpu_stats: ContainerCPUStats
}
