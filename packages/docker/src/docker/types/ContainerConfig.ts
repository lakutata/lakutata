/**
 * A container's resource settings, in the Docker Engine's terms. No method of the component returns or accepts it:
 * {@link DockerContainer} exposes these settings as its own properties (`memoryLimit`, `cpuSet`, `devices`,
 * `OOMKillDisable`, `restartPolicy`), and {@link ContainerSettingOptions} sets them.
 */
export type ContainerConfig = {
    /**
     * The memory limit, in bytes; `0` for no limit.
     */
    memory: number

    /**
     * The indexes of the host CPUs the container may run on (`[0, 1]`).
     */
    cpus: number[]

    /**
     * The host devices made available in the container.
     */
    devices: {
        /**
         * The path of the device on the host (`/dev/ttyUSB0`).
         */
        hostPath: string
        /**
         * The path of the device in the container.
         */
        containerPath: string
        /**
         * What the container's cgroup allows on the device: a combination of `r`, `w` and `m` (`"rwm"`).
         */
        cgroupPermissions: string
    }[]

    /**
     * `true` when the kernel's OOM killer does not kill the container's processes when it runs out of memory.
     */
    OOMKillDisable: boolean

    /**
     * The resource limits (ulimits) of the container's processes.
     */
    ulimits: {
        /**
         * The limit name (`nofile`, `nproc`).
         */
        name: string
        /**
         * The soft limit, which a process can raise up to the hard limit.
         */
        soft: number
        /**
         * The hard limit.
         */
        hard: number
    }[]

    /**
     * When Docker restarts the container after it exits.
     */
    restartPolicy: {
        /**
         * The policy: `''` or `'no'`, never; `'always'`, always; `'unless-stopped'`, always except after the container
         * was stopped by hand; `'on-failure'`, only when it exits with a non-zero code.
         */
        name: '' | 'no' | 'always' | 'unless-stopped' | 'on-failure'
        /**
         * With `'on-failure'`, the number of restarts before Docker gives up; `0` for no limit.
         */
        maximumRetryCount: number
    }
}
