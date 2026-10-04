import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How `DockerImage.remove()` removes an image by its ID (`docker rmi`).
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.getImage('api:1.3.0')
 * //Fails when a container uses the image
 * await image.remove({force: false})
 * ```
 */
export class ImageRemoveOptions extends DTO {

    /**
     * Remove the image even when it has several tags or stopped containers use it (`docker rmi --force`); `false`
     * fails the removal in these cases. A running container's image is not removed.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public force?: boolean

    /**
     * Keep the untagged parent images (`docker rmi --no-prune`); they are removed with the image when absent.
     */
    @Expect(DTO.Boolean().optional())
    public noprune?: boolean
}
