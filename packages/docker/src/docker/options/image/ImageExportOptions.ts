import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

/**
 * How `DockerImage.export()` saves an image as a tar archive (`docker save`), which {@link Docker.importImage} or
 * `docker load` loads back. `destination` is required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.getImage('api:1.4.0')
 * //Loaded back as api:stable
 * await image.export({destination: '/backup/api.tar', repoTag: 'api:stable'})
 * ```
 */
export class ImageExportOptions extends DTO {
    /**
     * Where the archive is written: the path of a file, created or replaced, or a writable stream, ended once the
     * archive is written. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | NodeJS.WritableStream

    /**
     * The `repo:tag` the archive names the image with, which the image gets back when loaded (`api:1.4.0`). Without it,
     * the image is saved by its ID: it is loaded back without a name.
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Tag the image with `repoTag` first when it does not have it; `false` fails the export with
     * `DockerImageRepoTagNotFoundException` instead.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public createRepoTagIfNotExists?: boolean
}
