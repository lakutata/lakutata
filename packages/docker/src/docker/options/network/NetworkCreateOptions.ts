import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {NetworkIPAMConfig} from '../../types/NetworkInfo.js'

/**
 * The network {@link Docker.createNetwork} creates (`docker network create`), the created network returned. Only `name`
 * is required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const network = await docker.createNetwork({
 *     name: 'back',
 *     internal: true,
 *     NetworkIPAMConfigs: [{subnet: '172.28.0.0/16', range: '172.28.5.0/24', gateway: '172.28.0.1'}]
 * })
 * //Its containers get their addresses from 172.28.5.0/24, or the static ones given to their settings
 * console.log(network.id)
 * ```
 */
export class NetworkCreateOptions extends DTO {
    /**
     * The network name, unique on the Docker host. Required.
     */
    @Expect(DTO.String().required())
    public name: string

    /**
     * The driver's options, by name (`{'com.docker.network.bridge.name': 'br-back'}` for `bridge`,
     * `{parent: 'eth0'}` for `macvlan` and `ipvlan`).
     * @default {}
     */
    @Expect(DTO.Object().optional().default({}))
    public options?: Record<string, string>

    /**
     * The network driver: `'bridge'`, `'ipvlan'` or `'macvlan'`; another value fails the validation.
     * @default 'bridge'
     */
    @Expect(DTO.String().valid('bridge', 'ipvlan', 'macvlan').optional().default('bridge'))
    public driver?: 'bridge' | 'ipvlan' | 'macvlan'

    /**
     * The network's address ranges, each one required to have its `subnet` (in CIDR notation) and its `gateway` (an
     * address without a prefix length), its `range` optional (in CIDR notation); a value in another notation fails the
     * validation. Empty or absent for a subnet Docker chooses. Its name is in PascalCase, unlike the other options.
     * @default []
     */
    @Expect(DTO.Array(DTO.Object({
        subnet: DTO.String().ip({cidr: 'required'}).required(),
        range: DTO.String().ip({cidr: 'required'}).optional(),
        gateway: DTO.String().ip({cidr: 'forbidden'}).required()
    })).optional().default([]))
    public NetworkIPAMConfigs?: NetworkIPAMConfig[]

    /**
     * Isolate the network from the outside (`docker network create --internal`): its containers reach each other, not
     * the host's networks nor the Internet.
     */
    @Expect(DTO.Boolean().optional())
    public internal?: boolean

    /**
     * Enable IPv6 on the network (`docker network create --ipv6`); give it an IPv6 subnet in `NetworkIPAMConfigs`, or
     * Docker allocates one from its default pools when configured.
     */
    @Expect(DTO.Boolean().optional())
    public enableIPv6?: boolean
}
