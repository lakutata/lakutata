import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ContainerLogsOptions extends DTO {
    /**
     * Keep connection after returning logs.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public follow?: boolean

    /**
     * Only return logs since this time, as a UNIX timestamp
     * @default 0
     */
    @Expect(DTO.Number().integer().optional().default(0))
    public since?: number

    /**
     * Only return logs before this time, as a UNIX timestamp
     * @default 0
     */
    @Expect(DTO.Number().integer().optional().default(0))
    public until?: number

    /**
     * Add timestamps to every log line
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public timestamps?: boolean

    /**
     * Only return this number of log lines from the end of the logs.
     */
    @Expect(DTO.Number().integer().optional())
    public tail?: number

}
