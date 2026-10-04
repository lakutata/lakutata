import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {ContainerdRestartPolicy} from '../../types/ContainerdRestartPolicy.js'

/**
 * The settings of a container updated while it runs (docker update): its resources, its restart policy
 */
export class ContainerResourceOptions extends DTO {
    /**
     * Memory limit in bytes (0: no limit)
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public memoryLimit?: number

    /**
     * The limit of the memory and of the swap in bytes (-1: unlimited swap, 0: no limit)
     */
    @Expect(DTO.Number().integer().min(-1).optional())
    public memorySwap?: number

    /**
     * The CPUs the container uses at most (0: no limit)
     */
    @Expect(DTO.Number().min(0).optional())
    public cpus?: number

    @Expect(DTO.Number().integer().min(0).optional())
    public cpuShares?: number

    /**
     * CPUs in which to allow execution (e.g., [0,1]), all of them when empty
     */
    @Expect(DTO.Array(DTO.Number().integer().min(0)).optional())
    public cpuSet?: number[]

    /**
     * The processes the container has at most (0: no limit)
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public pidsLimit?: number

    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean

    @Expect(DTO.String().allow('').pattern(/^(no|always|unless-stopped|on-failure(:\d+)?)$/).optional())
    public restartPolicy?: ContainerdRestartPolicy
}
