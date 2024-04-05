import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class ImageRemoveOptions extends DTO {

    @Expect(DTO.Boolean().optional())
    public force?: boolean

    @Expect(DTO.Boolean().optional())
    public noprune?: boolean
}
