/**
 * A binding of a port of a container to a port of the host in the Docker Engine API (PortBinding)
 */
export type PortBinding = {
    /**
     * The host address the port is bound on, all of them when empty
     */
    HostIp?: string
    HostPort: string
}
