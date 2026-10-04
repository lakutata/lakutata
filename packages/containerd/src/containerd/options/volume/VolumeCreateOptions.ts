import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class VolumeCreateOptions extends DTO {
    /**
     * Volume name
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).required())
    public name: string

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>
}
