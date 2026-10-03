import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerRemoveOptions extends DTO {
    /**
     * Kill the container when it is running
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public force?: boolean
}
