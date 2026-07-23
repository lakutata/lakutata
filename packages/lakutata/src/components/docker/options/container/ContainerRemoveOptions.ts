import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ContainerRemoveOptions extends DTO {
    /**
     * If the container is running, kill it before removing it.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public force?: boolean
}
