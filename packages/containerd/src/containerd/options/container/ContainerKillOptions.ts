import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerKillOptions extends DTO {
    /**
     * Signal to send to the container
     * @default 'SIGKILL'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Number().integer().positive()).optional().default('SIGKILL'))
    public signal?: string | number

    /**
     * Send it to all the processes of the container
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public all?: boolean
}
