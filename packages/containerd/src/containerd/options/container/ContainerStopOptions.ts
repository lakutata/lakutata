import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerStopOptions extends DTO {
    /**
     * Seconds to wait before killing the container
     * @default 10
     */
    @Expect(DTO.Number().min(0).optional().default(10))
    public timeout?: number

    /**
     * The signal stopping the container, its stop signal by default
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Number().integer().positive()).optional())
    public signal?: string | number
}
