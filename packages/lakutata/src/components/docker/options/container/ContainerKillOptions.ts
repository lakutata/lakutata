import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

export class ContainerKillOptions extends DTO {
    /**
     * Signal to send to the container as an integer or string (e.g. SIGINT).
     * @default "SIGKILL"
     */
    @Expect(DTO.Boolean().optional().default('SIGKILL'))
    public signal?: string
}
