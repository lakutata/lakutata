import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

export class ContainerRemoveOptions extends DTO {
    /**
     * If the container is running, kill it before removing it.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public force?: boolean
}
