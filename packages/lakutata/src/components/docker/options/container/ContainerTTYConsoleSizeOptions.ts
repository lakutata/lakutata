import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'

export class ContainerTTYConsoleSizeOptions extends DTO {

    @Expect(DTO.Number().required())
    public cols: number

    @Expect(DTO.Number().required())
    public rows: number
}
