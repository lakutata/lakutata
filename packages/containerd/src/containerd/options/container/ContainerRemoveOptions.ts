import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How {@link ContainerdContainer.remove} removes a container, with its snapshot, its network interfaces and its state
 * directory (its logs); its named volumes are kept. The field is optional.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * await container.remove({force: true})
 * ```
 */
export class ContainerRemoveOptions extends DTO {
    /**
     * Remove a running or paused container: all its processes are killed (`SIGKILL`) first, and its restart monitor
     * told not to restart it. Without it, such a container throws {@link ContainerdContainerStateException}.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public force?: boolean
}
