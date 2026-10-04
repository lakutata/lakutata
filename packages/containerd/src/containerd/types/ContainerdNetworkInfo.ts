export type ContainerdNetworkInfo = {
    id: string
    name: string
    /**
     * The plugin of CNI of the network (bridge, macvlan, ipvlan…)
     */
    driver: string
    /**
     * The networks of the system: host, none, and the default one (bridge), not removable
     */
    reserved: boolean
    internal: boolean
    enableIPv6: boolean
    subnets: string[]
    gateways: string[]
    labels: Record<string, string>
    /**
     * Its configuration list of CNI
     */
    file?: string
}
