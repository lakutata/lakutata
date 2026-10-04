import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {DockerAuthOptions} from '../auth/DockerAuthOptions.js'
import type {DockerOutputCallback} from '../../types/DockerOutputCallback.js'

/**
 * Which image {@link Docker.pullImage} pulls from its registry (`docker pull`), the pulled image returned. `repo` is
 * required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const nginx = await docker.pullImage({repo: 'nginx', tag: '1.27-alpine'})
 * const app = await docker.pullImage({
 *     repo: 'registry.example.com:5000/team/app',
 *     tag: '2.1.0',
 *     platform: 'linux/arm64',
 *     auth: {serverAddress: 'registry.example.com:5000', username: 'ci', password: process.env.REGISTRY_PASSWORD ?? ''},
 *     outputCallback: (output: Record<string, any>): void => console.log(output.status, output.id ?? '')
 * })
 * console.log(nginx.id, app.id)
 * ```
 */
export class ImagePullOptions extends DTO {
    /**
     * The repository, with its registry when it is not Docker Hub (`nginx`, `bitnami/redis`,
     * `registry.example.com:5000/team/app`), without the tag. Required.
     */
    @Expect(DTO.String().required())
    public repo: string

    /**
     * The tag pulled (`1.27-alpine`).
     * @default 'latest'
     */
    @Expect(DTO.String().optional().default('latest'))
    public tag?: string

    /**
     * The platform pulled from a multi-platform image, `os[/arch[/variant]]` (`linux/arm64`); the Docker host's
     * platform when absent.
     */
    @Expect(DTO.String().optional())
    public platform?: string

    /**
     * The credentials of a private registry; all of them are sent, the tokens included.
     */
    @Expect(DockerAuthOptions.optional())
    public auth?: DockerAuthOptions

    /**
     * Receive the pull progress as Docker sends it (`{status: 'Downloading', id: '<layer>', progressDetail: {current,
     * total}}`).
     */
    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}
