import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The locks of the process (a single instance)
 */
export class MemoryMutexOptions extends DTO {
    @Expect(DTO.String().valid('memory').required())
    public type: 'memory'
}
