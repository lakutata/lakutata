/**
 * A container port published on the host ({@link ContainerdContainer.ports}), with every host port forwarding to it.
 * It is read from the container's nerdctl labels, so the containers created by nerdctl report theirs too.
 */
export type ContainerdContainerPort = {
    /**
     * The host address the ports listen on; `'0.0.0.0'` for all of them.
     */
    host: string
    /**
     * The port in the container.
     */
    port: number
    /**
     * The protocol of the port.
     */
    type: 'tcp' | 'udp' | 'sctp'
    /**
     * The host ports forwarding to it.
     */
    hostPorts: number[]
}
