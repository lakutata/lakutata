import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

/**
 * How {@link Docker.importImage} loads an image from a tar archive made by `DockerImage.export()` or `docker save`
 * (`docker load`), the loaded image returned. `source` is required.
 * @example
 * ```typescript
 * import {createReadStream} from 'node:fs'
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.importImage({source: '/backup/api.tar'})
 * //Or from a stream: an upload, a download
 * const copy = await docker.importImage({source: createReadStream('/backup/api.tar')})
 * console.log(image.repoTags, copy.id)
 * ```
 */
export class ImageImportOptions extends DTO {

    /**
     * The archive: the path of a file, or a readable stream of it. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public source: string | NodeJS.ReadableStream

    /**
     * Have Docker report no progress while it loads the archive (`docker load --quiet`).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public quiet?: boolean
}
