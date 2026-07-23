import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {NetworkIPAMConfig} from '../../types/NetworkInfo.js'

export class NetworkCreateOptions extends DTO {
    /**
     * Network name
     */
    @Expect(DTO.String().required())
    public name: string

    /**
     * Options for specific driver
     */
    @Expect(DTO.Object().optional().default({}))
    public options?: Record<string, string>

    /**
     * Name of the network driver to use
     * @default "bridge"
     */
    @Expect(DTO.String().valid('bridge', 'ipvlan', 'macvlan').optional().default('bridge'))
    public driver?: 'bridge' | 'ipvlan' | 'macvlan'

    @Expect(DTO.Array(DTO.Object({
        subnet: DTO.String().ip({cidr: 'required'}).required(),
        range: DTO.String().ip({cidr: 'required'}).optional(),
        gateway: DTO.String().ip({cidr: 'forbidden'}).required()
    })).default([]))
    public NetworkIPAMConfigs: NetworkIPAMConfig[]

    /**
     * Restrict external access to the network
     */
    @Expect(DTO.Boolean().optional())
    public internal?: boolean

    /**
     * Enable IPv6 on the network
     */
    @Expect(DTO.Boolean().optional())
    public enableIPv6?: boolean
}
