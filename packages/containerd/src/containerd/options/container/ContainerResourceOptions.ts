import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {ContainerdRestartPolicy} from '../../types/ContainerdRestartPolicy.js'

/**
 * The settings {@link ContainerdContainer.update} changes without creating the container again (as `docker update`
 * does): its resource limits and its restart policy. An update giving only these fields is validated by this class and
 * applied to the container's runtime specification and, while it runs, to its cgroup; the fields not given keep their
 * values. A limit set to `0` (`[]` for `cpuSet`) is removed at once, from the running container too, and from the
 * settings the container is created again with. Every field is optional. An update with any other field of
 * {@link ContainerCreateOptions} creates the container again instead.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * //Applied to the running container
 * await container.update({memoryLimit: 512 * 1024 * 1024, cpus: 2, restartPolicy: 'on-failure:3'})
 * ```
 */
export class ContainerResourceOptions extends DTO {
    /**
     * The memory limit in bytes, a non-negative integer. `0` removes it, with the swap limit (unlimited memory and
     * swap). A swap limit of twice the memory (the default one) follows the new limit; another swap limit is kept, and
     * must stay at least the memory limit.
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public memoryLimit?: number

    /**
     * The limit of the memory and the swap together in bytes, at least the memory limit; `-1` or `0` for unlimited
     * swap. A positive value needs a memory limit (the container's, or `memoryLimit`). Discarded when the kernel does
     * not limit the swap of the cgroups.
     */
    @Expect(DTO.Number().integer().min(-1).optional())
    public memorySwap?: number

    /**
     * The CPUs the container uses at most, a non-negative number (`1.5`), as a CFS quota per period of 100000 µs; `0`
     * removes the limit, at once.
     */
    @Expect(DTO.Number().min(0).optional())
    public cpus?: number

    /**
     * The relative CPU weight in cgroup v1 CPU shares (`1024` is the kernel's default), a non-negative integer. `0`
     * removes it: the running container gets the default weight (`1024` shares).
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public cpuShares?: number

    /**
     * The CPUs the container may run on, by their numbers (`[0, 1]`). `[]` removes the restriction: the running
     * container may run on every online CPU of the machine.
     */
    @Expect(DTO.Array(DTO.Number().integer().min(0)).optional())
    public cpuSet?: number[]

    /**
     * The processes (and threads) the container may have at most, a non-negative integer; `0` removes the limit, at
     * once.
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public pidsLimit?: number

    /**
     * Disable the kernel's OOM killer for the container (cgroup v1 only).
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean

    /**
     * The restart policy ({@link ContainerdRestartPolicy}); `''` or `'no'` removes it. A running container is then
     * watched by containerd's restart monitor at once.
     */
    @Expect(DTO.String().allow('').pattern(/^(no|always|unless-stopped|on-failure(:\d+)?)$/).optional())
    public restartPolicy?: ContainerdRestartPolicy
}
