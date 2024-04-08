import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {ContainerDevice} from '../../types/ContainerDevice.js'
import {type ContainerRestartPolicy} from '../../types/ContainerRestartPolicy.js'
import {ContainerPort} from '../../types/ContainerPort.js'
import {ContainerBind} from '../../types/ContainerBind.js'
import {ContainerNetwork} from '../../types/ContainerNetwork.js'

export class ContainerSettingOptions extends DTO {

    /**
     * Container name
     */
    @Expect(DTO.String().optional())
    public name?: string

    /**
     * Container hostname
     */
    @Expect(DTO.String().optional())
    public hostname?: string

    /**
     * Gives the container full access to the host.
     */
    @Expect(DTO.Boolean().optional())
    public privileged?: boolean

    /**
     * Attach standard streams to a TTY
     */
    @Expect(DTO.Boolean().optional())
    public tty?: boolean

    /**
     * Container environment variables
     */
    @Expect(DTO.Object().optional())
    public env?: Record<string, string>

    /**
     * Memory limit in bytes.
     * @default 0 (No limit)
     */
    @Expect(DTO.Number().optional())
    public memoryLimit?: number

    /**
     * CPUs in which to allow execution (e.g., [0,1]).
     */
    @Expect(DTO.Array(DTO.Number().integer()).optional())
    public cpuSet?: number[]

    /**
     * Container restart policy
     */
    @Expect(DTO.String().optional().allow('').valid('', 'no', 'always', 'unless-stopped', 'on-failure'))
    public restartPolicy?: ContainerRestartPolicy

    /**
     * Container expose ports
     */
    @Expect(DTO.Array(DTO.Object({
        port: DTO.Number().port().required(),
        type: DTO.String().valid('tcp', 'udp').required(),
        hostPorts: DTO.Array(DTO.Number().port()).optional().default([])
    })).optional())
    ports?: Omit<ContainerPort, 'host'>[]

    /**
     * Container binds
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        rw: DTO.Boolean().required()
    })).optional())
    public binds?: ContainerBind[]

    /**
     * A list of devices to add to the container.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        cgroupPermissions: DTO.String().optional().default('rwm')
    })).optional())
    // public devices?: ContainerDevice[]
    public devices?: (Pick<ContainerDevice, 'hostPath' | 'containerPath'> & Partial<Pick<ContainerDevice, 'cgroupPermissions'>>)[]

    /**
     * Container networks
     */
    @Expect(DTO.Array(DTO.Object({
        networkName: DTO.String().required(),
        ip: DTO.String().ip({version: 'ipv4'}).optional(),
        ipv6: DTO.String().ip({version: 'ipv6'}).optional()
    })).optional())
    public networks?: Partial<Pick<ContainerNetwork, 'networkName' | 'ip' | 'ipv6'>>[]

    /**
     * Disable OOM Killer for the container.
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean


}
