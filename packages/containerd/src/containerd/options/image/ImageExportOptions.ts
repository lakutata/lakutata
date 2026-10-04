import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

/**
 * Where {@link Containerd.exportImages} and {@link ContainerdImage.export} write their tar archive: an OCI image layout
 * holding every platform the content store has of each image, named by its annotations, with the `manifest.json`
 * `docker load` reads (the machine's platform, or the first one). {@link Containerd.importImage}, `nerdctl load`,
 * `ctr images import` and `docker load` load it. `destination` is required. Unlike the Docker component's options,
 * the images keep their names (there is no `repoTag`).
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * await containerd.exportImages(['nginx:1.27', 'redis:7'], {destination: '/backup/images.tar'})
 * const image = await containerd.getImage('nginx:1.27')
 * await image.export({destination: '/backup/nginx.tar'})
 * ```
 */
export class ImageExportOptions extends DTO {
    /**
     * Where the archive is written: the path of a file, created or replaced, or a writable stream, ended once the
     * archive is written. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | NodeJS.WritableStream
}
