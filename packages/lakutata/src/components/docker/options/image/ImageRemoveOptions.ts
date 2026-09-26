import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

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
