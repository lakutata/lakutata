import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

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
