import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {DockerAuthOptions} from '../auth/DockerAuthOptions.js'
import {type DockerOutputCallback} from '../../types/DockerOutputCallback.js'

/**
 * Where `DockerImage.push()` pushes an image (`docker push`): the image is tagged `repo:tag` first, then pushed to the
 * registry of `repo`. `repo` is required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.getImage('api:1.4.0')
 * await image.push({
 *     repo: 'registry.example.com:5000/team/api',
 *     tag: '1.4.0',
 *     auth: {serverAddress: 'registry.example.com:5000', username: 'ci', password: process.env.REGISTRY_PASSWORD ?? ''}
 * })
 * ```
 */
export class ImagePushOptions extends DTO {
    /**
     * The repository pushed to, with its registry when it is not Docker Hub (`registry.example.com:5000/team/api`,
     * `myuser/api`), without the tag. Required.
     */
    @Expect(DTO.String().required())
    public repo: string

    /**
     * The tag pushed (`1.4.0`).
     * @default 'latest'
     */
    @Expect(DTO.String().optional().default('latest'))
    public tag?: string

    /**
     * The credentials of the registry; all of them are sent, the tokens included.
     */
    @Expect(DockerAuthOptions.optional())
    public auth?: DockerAuthOptions

    /**
     * Receive the push progress as Docker sends it (`{status: 'Pushing', id: '<layer>', progressDetail: {current,
     * total}}`).
     */
    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}
