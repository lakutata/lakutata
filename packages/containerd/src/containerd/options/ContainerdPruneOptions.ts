import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerdPruneOptions extends DTO {
    /**
     * Prune the stopped containers
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public containers?: boolean

    /**
     * Prune the dangling images (named by their digests, without tags) no container uses
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public images?: boolean

    /**
     * Prune all the images no container uses (their tags too)
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public allImages?: boolean

    /**
     * Prune the networks no container uses (the ones of nerdctl, not the default one)
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public networks?: boolean

    /**
     * Prune the volumes no container uses (their data removed)
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public volumes?: boolean
}
