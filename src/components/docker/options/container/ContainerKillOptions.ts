import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ContainerKillOptions extends DTO {
    /**
     * Signal to send to the container as an integer or string (e.g. SIGINT).
     * @default "SIGKILL"
     */
    @Expect(DTO.Boolean().optional().default('SIGKILL'))
    public signal?: string
}
