import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * What {@link Containerd.prune} removes; every field is optional. A resource whose removal fails is skipped. Unlike the
 * Docker component's options, the volumes are kept by default, and `allImages` removes the tagged images too.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * //The stopped containers and the dangling images (the defaults), and the unused volumes with their data
 * const removed = await containerd.prune({volumes: true})
 * console.log(removed.containers, removed.images, removed.volumes)
 * ```
 */
export class ContainerdPruneOptions extends DTO {
    /**
     * Remove the containers which do not run (their status `'created'` or `'exited'`), with their snapshots and their
     * logs.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public containers?: boolean

    /**
     * Remove the dangling images (named by a digest, without a tag) no container uses.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public images?: boolean

    /**
     * Remove all the images no container uses, the tagged ones too (whatever `images` is).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public allImages?: boolean

    /**
     * Remove the networks no container uses, among the ones created by nerdctl or the component; never `host`, `none`
     * nor the default `bridge` network.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public networks?: boolean

    /**
     * Remove the volumes no container uses, with their data.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public volumes?: boolean
}
