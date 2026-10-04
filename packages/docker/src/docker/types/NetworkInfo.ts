import {Time} from '@lakutata/utils/Time'

/**
 * An IP address range of a Docker network (its IPAM configuration): read from a network ({@link NetworkInfo}) and given
 * to {@link NetworkCreateOptions.NetworkIPAMConfigs}.
 */
export type NetworkIPAMConfig = {
    /**
     * The network's subnet, in CIDR notation (`172.28.0.0/16`).
     */
    subnet: string
    /**
     * The part of the subnet Docker allocates the containers' addresses from, in CIDR notation (`172.28.5.0/24`); the
     * whole subnet when absent.
     */
    range?: string
    /**
     * The gateway's IP address, without a prefix length (`172.28.0.1`).
     */
    gateway: string
}

/**
 * A Docker network, as {@link Docker.getNetwork}, {@link Docker.listNetworks} and {@link Docker.createNetwork} return
 * it.
 */
export type NetworkInfo = {
    /**
     * The network ID.
     */
    id: string
    /**
     * The network name.
     */
    name: string
    /**
     * The network driver, as Docker reports it: `'bridge'`, `'ipvlan'` or `'macvlan'` for the networks created by this
     * component; also `'host'`, `'null'` (the `none` network), `'overlay'` or a plugin's name for the others.
     */
    driver: string
    /**
     * `true` for the networks Docker creates itself: `bridge`, `host` and `none`.
     */
    reserved: boolean
    /**
     * `true` when the network has no external access.
     */
    internal: boolean
    /**
     * `true` when IPv6 is enabled on the network.
     */
    enableIPv6: boolean
    /**
     * The network's address ranges, empty when it has none.
     */
    IPAMConfigs: NetworkIPAMConfig[]
    /**
     * When the network was created.
     */
    createdAt: Time
}
