import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How `DockerContainer.remove()` removes a container (`docker rm -v`): its anonymous volumes are removed with it, the
 * named volumes are kept.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * await container.remove({force: true})
 * ```
 */
export class ContainerRemoveOptions extends DTO {
    /**
     * Kill the container first when it is running (`docker rm --force`); without it, removing a running container
     * fails.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public force?: boolean
}
