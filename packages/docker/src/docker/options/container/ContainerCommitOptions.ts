import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How `DockerContainer.commit()` creates an image of the container's current file system (`docker commit`), the
 * created image returned.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * const image = await container.commit({repoTag: 'web-snapshot:2026-10-04'})
 * console.log(image.id)
 * ```
 */
export class ContainerCommitOptions extends DTO {
    /**
     * The repository and tag of the image, `repo:tag` (`my-app:snapshot`, `registry.example.com:5000/team/app:1.0`); a
     * repository without a tag is tagged `latest`. Without it, the image has no name (dangling) and is known by its ID
     * only.
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Pause the container while the image is created, for a consistent file system; it resumes after.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public pauseBeforeCommitting?: boolean

}
