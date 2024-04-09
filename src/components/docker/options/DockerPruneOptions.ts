import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class DockerPruneOptions extends DTO {
    /**
     * Prune unused containers
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public containers?: boolean

    /**
     * Prune unused images
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public images?: boolean

    /**
     * Prune unused networks
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public networks?: boolean

    /**
     * Prune unused volumes
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public volumes?: boolean
}
