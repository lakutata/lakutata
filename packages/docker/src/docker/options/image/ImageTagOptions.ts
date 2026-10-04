import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The name `DockerImage.tag()` gives an image (`docker tag`), in addition to its other ones. `repo` is required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.getImage('api:1.4.0')
 * await image.tag({repo: 'registry.example.com:5000/team/api', tag: 'stable'})
 * console.log(image.repoTags)
 * ```
 */
export class ImageTagOptions extends DTO {
    /**
     * The repository, with its registry when it is not Docker Hub (`someuser/someimage`,
     * `registry.example.com:5000/team/api`). Required.
     */
    @Expect(DTO.String().required())
    public repo: string

    /**
     * The tag (`stable`); Docker uses `latest` when absent.
     */
    @Expect(DTO.String().optional())
    public tag?: string
}
