import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

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
