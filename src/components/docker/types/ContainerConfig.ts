export type ContainerConfig = {
    /**
     * Memory limit in bytes
     */
    memory: number

    /**
     * CPUs in which to allow execution (e.g., [0,1]).
     */
    cpus: number[]

    devices: {
        hostPath: string
        containerPath: string
        cgroupPermissions: string
    }[]

    /**
     * Disable OOM Killer for the container
     */
    OOMKillDisable: boolean

    /**
     * A list of resource limits to set in the container
     */
    ulimits: {
        name: string
        soft: number
        hard: number
    }[]

    restartPolicy: {
        /**
         * "" Empty string means not to restart
         * "no" Do not automatically restart
         * "always" Always restart
         * "unless-stopped" Restart always except when the user has manually stopped the container
         * "on-failure" Restart only when the container exit code is non-zero
         */
        name: '' | 'no' | 'always' | 'unless-stopped' | 'on-failure'
        /**
         * If on-failure is used, the number of times to retry before giving up
         */
        maximumRetryCount: number
    }
}
