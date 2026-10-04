import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * A CNI network {@link Containerd.createNetwork} creates, as `nerdctl network create` does: its configuration list
 * `nerdctl-<name>.conflist` written to the component's `cniConfigPath` (nerdctl sees it), its main plugin followed by
 * `portmap`, and `firewall` and `tuning` when they are installed. Containers join it by
 * {@link ContainerCreateOptions.networks}. Only `name` is required. A name or a subnet in use throws
 * {@link ContainerdNetworkConflictException}. Unlike the Docker component's options, the IPAM settings are flat fields
 * (one IPv4 subnet, one IPv6 subnet), and IPv6 is enabled by giving its subnet.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const network = await containerd.createNetwork({
 *     name: 'backend',
 *     subnet: '10.20.0.0/24',
 *     ipRange: '10.20.0.128/25',
 *     labels: {project: 'shop'}
 * })
 * await containerd.createContainer({image: 'redis:7', networks: [{networkName: network.name, ip: '10.20.0.10'}]})
 * ```
 */
export class NetworkCreateOptions extends DTO {
    /**
     * The name of the network, matching `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; not `host`, `none` nor `bridge` (the default
     * nerdctl network). Required.
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).required())
    public name: string

    /**
     * The main CNI plugin, installed in the component's `cniPath`: `'bridge'`, a Linux bridge (`br-<12 digits of its
     * ID>`) with NAT to the outside; `'macvlan'` (bridge mode) or `'ipvlan'` (L2 mode), the containers on the network
     * of the host interface `parent`.
     * @default 'bridge'
     */
    @Expect(DTO.String().valid('bridge', 'ipvlan', 'macvlan').optional().default('bridge'))
    public driver?: 'bridge' | 'ipvlan' | 'macvlan'

    /**
     * The IPv4 subnet in CIDR notation (`'10.20.0.0/24'`), overlapping no other network's. By default, the first free
     * `/24` of `10.4.0.0/16` (the nerdctl range, `10.4.0.0/24` being the default network's).
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'required'}).optional())
    public subnet?: string

    /**
     * The IPv4 gateway, an address of the subnet without a prefix length (`'10.20.0.254'`); the first address of the
     * subnet by default.
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'forbidden'}).optional())
    public gateway?: string

    /**
     * The range the container addresses are given from, in CIDR notation inside the subnet (`'10.20.0.128/25'`); the
     * whole subnet by default.
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'required'}).optional())
    public ipRange?: string

    /**
     * The host interface (`'eth0'`) a `macvlan` or `ipvlan` network is attached to, required by them; ignored by
     * `bridge`.
     */
    @Expect(DTO.String().optional())
    public parent?: string

    /**
     * Cut the network from the outside: no default route in the containers and, for a bridge, no gateway on the host
     * and no masquerading.
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public internal?: boolean

    /**
     * The MTU of the container interfaces in bytes, at least `68`; the plugin's default (the host's, `1500` usually)
     * when not given.
     */
    @Expect(DTO.Number().integer().min(68).optional())
    public mtu?: number

    /**
     * An IPv6 subnet in CIDR notation (`'fd00:4:10::/64'`), besides the IPv4 one, overlapping no other network's; the
     * network has no IPv6 without it.
     */
    @Expect(DTO.String().ip({version: 'ipv6', cidr: 'required'}).optional())
    public ipv6Subnet?: string

    /**
     * The IPv6 gateway, an address of `ipv6Subnet` without a prefix length; the first address of the subnet by
     * default. Ignored without `ipv6Subnet`.
     */
    @Expect(DTO.String().ip({version: 'ipv6', cidr: 'forbidden'}).optional())
    public ipv6Gateway?: string

    /**
     * The labels of the network, written to its configuration.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>
}
