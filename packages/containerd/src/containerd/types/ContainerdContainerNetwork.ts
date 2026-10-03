export type ContainerdContainerNetwork = {
    networkName: string
    /**
     * Its interface in the container (eth0)
     */
    interface: string
    mac: string
    ip: string
    gateway: string
    ipPrefixLen: number
    ipv6: string
    ipv6Gateway: string
}
