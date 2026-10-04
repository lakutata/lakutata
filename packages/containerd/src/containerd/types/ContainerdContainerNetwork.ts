/**
 * The interface of a container on one of its CNI networks ({@link ContainerdContainer.networks}). Its addresses are
 * known while the container runs (its interface exists while its task does); the strings are empty otherwise, and for
 * the families the network has no subnet of.
 */
export type ContainerdContainerNetwork = {
    /**
     * The name of the network (`'bridge'`, the default nerdctl network, or one created by
     * {@link Containerd.createNetwork}).
     */
    networkName: string
    /**
     * The name of the interface in the container: `'eth0'` on its first network, `'eth1'` on the second one…
     */
    interface: string
    /**
     * The MAC address of the interface (`'2a:5f:…'`), `''` when unknown.
     */
    mac: string
    /**
     * The IPv4 address of the container on the network, `''` when it has none.
     */
    ip: string
    /**
     * The IPv4 gateway of the network, `''` when it has none.
     */
    gateway: string
    /**
     * The prefix length of the IPv4 subnet (`24` for a `/24`), `0` when the container has no IPv4 address.
     */
    ipPrefixLen: number
    /**
     * The IPv6 address of the container on the network, `''` when the network has no IPv6 subnet.
     */
    ipv6: string
    /**
     * The IPv6 gateway of the network, `''` when it has none.
     */
    ipv6Gateway: string
}
