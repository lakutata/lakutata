import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerExecOptions extends DTO {
    /**
     * Command to run, as a string or array of strings.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).required())
    public cmd: string | string[]
}
