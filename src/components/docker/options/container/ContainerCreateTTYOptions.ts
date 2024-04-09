import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {ContainerTTYConsoleSizeOptions} from './ContainerTTYConsoleSizeOptions.js'

export class ContainerCreateTTYOptions extends DTO {
    /**
     * Command to run, as a string or array of strings.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public cmd?: string | string[]

    /**
     * Initial console size
     */
    @Expect(ContainerTTYConsoleSizeOptions.optional())
    public consoleSize?: ContainerTTYConsoleSizeOptions
}
