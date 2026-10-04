import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

/**
 * How {@link Containerd.importImage} loads the images of a tar archive into containerd, returning them: an OCI image
 * layout (the archive of {@link ImageExportOptions}, `nerdctl save`, `docker save` of Docker 25+), or an archive of an
 * older `docker save`. `source` is required. An archive with no image throws {@link ContainerdImageImportException}.
 * @example
 * ```typescript
 * import {createReadStream} from 'node:fs'
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const images = await containerd.importImage({source: '/backup/images.tar'})
 * //Or from a stream (an upload, a download), under another name
 * const [copy] = await containerd.importImage({source: createReadStream('/backup/nginx.tar'), name: 'nginx:backup'})
 * console.log(images.map(image => image.name), copy.name)
 * ```
 */
export class ImageImportOptions extends DTO {
    /**
     * The archive: the path of a file, or a readable stream of it. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public source: string | NodeJS.ReadableStream

    /**
     * The name given to the imported image (`'app:1.0'`, normalized to `'docker.io/library/app:1.0'`), instead of the
     * names the archive has. Only for an archive of one image (its tags count as one): an archive of several images
     * given a name throws {@link ContainerdImageImportException}, nothing imported. By default, the archive's names; an
     * older `docker save` image without one is named `import-<milliseconds>@<digest>`.
     */
    @Expect(DTO.String().optional())
    public name?: string

    /**
     * Unpack the images' layers into snapshots, for the platforms the machine runs
     * ({@link Containerd.supportedPlatforms}), so that their containers are created at once. A failure to unpack fails the import with
     * {@link ContainerdImageImportException}, the images stored and named.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public unpack?: boolean
}
