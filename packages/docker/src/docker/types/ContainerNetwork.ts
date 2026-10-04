/**
 * A network a container is connected to, with its address on it, as Docker reports it (`DockerContainer.networks`).
 * The addresses are empty strings while the container is not running.
 */
export type ContainerNetwork = {
    /**
     * The network name (`bridge`, `my-network`).
     */
    networkName: string
    /**
     * The network ID.
     */
    networkId: string
    /**
     * The ID of the container's endpoint on the network.
     */
    endpointId: string
    /**
     * The container's MAC address on the network (`02:42:ac:11:00:02`).
     */
    mac: string
    /**
     * The container's IPv4 address on the network (`172.17.0.2`).
     */
    ip: string
    /**
     * The network's IPv4 gateway (`172.17.0.1`).
     */
    gateway: string
    /**
     * The prefix length of the IPv4 subnet (`16` for a `/16`).
     */
    ipPrefixLen: number
    /**
     * The container's global IPv6 address on the network, an empty string without IPv6.
     */
    ipv6: string
    /**
     * The network's IPv6 gateway, an empty string without IPv6.
     */
    ipv6Gateway: string
    /**
     * The prefix length of the IPv6 subnet.
     */
    ipv6PrefixLen: number
}
