import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class NetworkCreateOptions extends DTO {
    /**
     * Network name
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).required())
    public name: string

    /**
     * Name of the network driver to use (the plugin of CNI)
     * @default "bridge"
     */
    @Expect(DTO.String().valid('bridge', 'ipvlan', 'macvlan').optional().default('bridge'))
    public driver?: 'bridge' | 'ipvlan' | 'macvlan'

    /**
     * Its subnet, a free one of 10.4.0.0/16 by default
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'required'}).optional())
    public subnet?: string

    /**
     * Its gateway, the first address of its subnet by default
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'forbidden'}).optional())
    public gateway?: string

    /**
     * The range of the addresses given to the containers, in its subnet
     */
    @Expect(DTO.String().ip({version: 'ipv4', cidr: 'required'}).optional())
    public ipRange?: string

    /**
     * The interface of the host of a macvlan or ipvlan network
     */
    @Expect(DTO.String().optional())
    public parent?: string

    /**
     * Restrict external access to the network
     */
    @Expect(DTO.Boolean().optional())
    public internal?: boolean

    @Expect(DTO.Number().integer().min(68).optional())
    public mtu?: number

    /**
     * Its subnet of IPv6, besides its subnet of IPv4 (fd00:4:10::/64)
     */
    @Expect(DTO.String().ip({version: 'ipv6', cidr: 'required'}).optional())
    public ipv6Subnet?: string

    /**
     * Its gateway of IPv6, the first address of its subnet by default
     */
    @Expect(DTO.String().ip({version: 'ipv6', cidr: 'forbidden'}).optional())
    public ipv6Gateway?: string

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>
}
