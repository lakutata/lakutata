import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerLogsOptions extends DTO {
    /**
     * Keep the stream while the container runs
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public follow?: boolean

    /**
     * Only return this number of log lines from the end of the logs.
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public tail?: number
}
