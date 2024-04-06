import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ImageTagOptions extends DTO {
    /**
     * The repository to tag in. For example, someuser/someimage.
     */
    @Expect(DTO.String().required())
    public repo: string

    /**
     * The name of the new tag.
     */
    @Expect(DTO.String().optional())
    public tag?: string
}
