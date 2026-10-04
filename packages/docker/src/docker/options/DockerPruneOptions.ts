import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * Which unused resources {@link Docker.prune} removes, each kind as its `docker … prune` command does without options.
 * Called without options, it prunes the containers and the images; the networks and the volumes only when asked (the
 * volumes, as `docker system prune --volumes`).
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * //The stopped containers and the unused networks, keeping the images and the volumes
 * await docker.prune({containers: true, images: false, networks: true, volumes: false})
 * ```
 */
export class DockerPruneOptions extends DTO {
    /**
     * Remove the stopped containers (`docker container prune`).
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public containers?: boolean

    /**
     * Remove the dangling images, untagged and not used by a container (`docker image prune`, without `--all`).
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public images?: boolean

    /**
     * Remove the networks no container uses (`docker network prune`).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public networks?: boolean

    /**
     * Remove the volumes no container uses (`docker volume prune`): the anonymous ones only on Docker Engine 23 and
     * later (API 1.42), the named ones too before.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public volumes?: boolean
}
