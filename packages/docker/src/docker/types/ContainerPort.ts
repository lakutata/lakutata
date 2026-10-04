/**
 * A container port and the host ports publishing it (`DockerContainer.ports`). The container has one entry per address
 * it has on its networks, per port exposed by its image or published, and per protocol; the entries of a port exposed
 * but not published have no host port. A container without an address (not running) has none.
 */
export type ContainerPort = {
    /**
     * The container's address on one of its networks: an IPv4 address (`172.17.0.2`), or an IPv6 address between
     * brackets (`[fd00::2]`). It is not a host address.
     */
    host: string
    /**
     * The port in the container (`8080`).
     */
    port: number
    /**
     * The protocol of the port.
     */
    type: 'tcp' | 'udp'
    /**
     * The host ports publishing it, each one once (Docker binds a port on the host's IPv4 and IPv6 addresses); empty
     * when it is not published.
     */
    hostPorts: number[]
}
