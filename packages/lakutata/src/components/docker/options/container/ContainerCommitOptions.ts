import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

export class ContainerCommitOptions extends DTO {
    /**
     * Commit repoTag
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Whether to pause the container before committing
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public pauseBeforeCommitting?: boolean

}
