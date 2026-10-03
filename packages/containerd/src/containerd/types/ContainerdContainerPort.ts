export type ContainerdContainerPort = {
    /**
     * The address of the host it is published on
     */
    host: string
    port: number
    type: 'tcp' | 'udp' | 'sctp'
    hostPorts: number[]
}
