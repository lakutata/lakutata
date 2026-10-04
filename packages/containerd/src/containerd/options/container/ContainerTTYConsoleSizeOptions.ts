import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerTTYConsoleSizeOptions extends DTO {

    @Expect(DTO.Number().integer().positive().required())
    public cols: number

    @Expect(DTO.Number().integer().positive().required())
    public rows: number
}
