import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How {@link ContainerdContainer.commit} saves a container's file system changes as a new image: one layer on its
 * image, for the container's platform, with the image configuration changed as asked; the image is unpacked so it can
 * run at once. Every field is optional. Unlike the Docker component's options, the image configuration can be changed
 * and the commit commented, and an image committed without `repoTag` is still named.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('builder')
 * const image = await container.commit({
 *     repoTag: 'registry.example.com/app:1.1',
 *     changes: {cmd: ['node', 'server.js'], env: {NODE_ENV: 'production'}, exposedPorts: ['3000/tcp']},
 *     comment: 'Dependencies installed',
 *     author: 'CI <ci@example.com>'
 * })
 * console.log(image.name, image.digest)
 * ```
 */
export class ContainerCommitOptions extends DTO {
    /**
     * The name of the new image (`'app:1.1'`, normalized to `'docker.io/library/app:1.1'`). By default, the
     * container's image repository with the tag `commit-<milliseconds since the epoch>`.
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Pause a running container while its changes are read, so that they are consistent; it is resumed after, even on
     * a failure.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public pauseBeforeCommitting?: boolean

    /**
     * The changes of the new image's configuration, every field optional: `cmd` and `entrypoint` replace the image's
     * ones; `env` adds variables (replacing them by name); `workingDir` and `user` replace the image's ones; `labels`
     * are added; `exposedPorts` adds ports as `"8080"` (TCP) or `"8080/udp"` (`tcp`, `udp` or `sctp`).
     */
    @Expect(DTO.Object({
        cmd: DTO.Array(DTO.String()).optional(),
        entrypoint: DTO.Array(DTO.String()).optional(),
        env: DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional(),
        workingDir: DTO.String().optional(),
        user: DTO.String().optional(),
        labels: DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional(),
        exposedPorts: DTO.Array(DTO.String().pattern(/^\d+(\/(tcp|udp|sctp))?$/)).optional()
    }).optional())
    public changes?: { cmd?: string[], entrypoint?: string[], env?: Record<string, string>, workingDir?: string, user?: string, labels?: Record<string, string>, exposedPorts?: string[] }

    /**
     * The comment of the commit, written to the image history.
     */
    @Expect(DTO.String().optional())
    public comment?: string

    /**
     * The author of the commit (`'Name <email>'`), written to the image configuration and its history.
     */
    @Expect(DTO.String().optional())
    public author?: string
}
