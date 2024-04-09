import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

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
