import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class DataFieldDTO extends DTO {

    @Expect(DTO.String().allow('int32', 'int64', 'float', 'double').only().required())
    public type: 'int32' | 'int64' | 'float' | 'double'

    @Expect(DTO.String().required())
    public unit: string

    @Expect(DTO.String().allow('').optional().default(''))
    public description: string
}