import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {ContainerDevice} from '../../types/ContainerDevice.js'

export class ContainerUpdateOptions extends DTO {
    /**
     * Memory limit in bytes.
     * @default 0 (No limit)
     */
    @Expect(DTO.Number().optional())
    public memory?: number

    /**
     * CPUs in which to allow execution (e.g., [0,1]).
     */
    @Expect(DTO.Array(DTO.Number().integer()).optional())
    public cpus?: number[]

    /**
     * A list of devices to add to the container.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        cgroupPermissions: DTO.String().optional().default('rwm')
    })).optional())
    public devices?: ContainerDevice[]

    /**
     * Disable OOM Killer for the container.
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean


}
