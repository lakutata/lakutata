import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ContainerExecOptions extends DTO {
    /**
     * Command to run, as a string or array of strings.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).required())
    public cmd: string | string[]
}
