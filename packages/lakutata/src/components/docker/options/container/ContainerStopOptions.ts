import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

export class ContainerStopOptions extends DTO {
    /**
     * Stop signal
     */
    @Expect(DTO.String().optional())
    public signal?: string

    /**
     * Number of seconds to wait before killing the container
     */
    @Expect(DTO.Number().optional())
    public timeout?: number
}
