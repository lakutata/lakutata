import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class ContainerTTYConsoleSizeOptions extends DTO {

    @Expect(DTO.Number().required())
    public cols: number

    @Expect(DTO.Number().required())
    public rows: number
}
