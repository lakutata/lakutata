/**
 * A network containers can join ({@link Containerd.listNetworks}, {@link Containerd.getNetwork}): `host` and `none`,
 * and the CNI networks of the component's CNI configuration directory (the nerdctl ones, as `nerdctl network ls` lists
 * them, and the other configuration lists there).
 */
export type ContainerdNetworkInfo = {
    /**
     * Its ID: `'host'` and `'none'` for those, the 64 hexadecimal digits nerdctl gives a CNI network.
     */
    id: string
    /**
     * Its name, the one the containers give in {@link ContainerCreateOptions.networks}.
     */
    name: string
    /**
     * Its main CNI plugin (`'bridge'`, `'macvlan'`, `'ipvlan'`…); `'host'` and `'none'` for those networks.
     */
    driver: string
    /**
     * Whether the component cannot remove it: `host`, `none`, the default nerdctl network (`bridge`), and the CNI
     * configurations not written by nerdctl or the component (their files not named `nerdctl-*.conflist`).
     */
    reserved: boolean
    /**
     * Whether it is cut from the outside: a bridge network without the host's gateway and masquerading, and `none`.
     */
    internal: boolean
    /**
     * Whether it has an IPv6 subnet.
     */
    enableIPv6: boolean
    /**
     * Its subnets in CIDR notation (`'10.4.1.0/24'`, `'fd00:4:10::/64'`), `[]` for `host` and `none`.
     */
    subnets: string[]
    /**
     * The gateways of its subnets (`'10.4.1.1'`).
     */
    gateways: string[]
    /**
     * Its labels (the ones given to {@link NetworkCreateOptions.labels}, and the `nerdctl/…` ones).
     */
    labels: Record<string, string>
    /**
     * The path of its CNI configuration list (`/etc/cni/net.d/nerdctl-backend.conflist`); undefined for `host` and
     * `none`.
     */
    file?: string
}
