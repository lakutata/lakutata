import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class ImageRemoveOptions extends DTO {

    /**
     * Force remove image
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public force?: boolean

    @Expect(DTO.Boolean().optional())
    public noprune?: boolean
}
