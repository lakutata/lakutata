import {DTO} from '../../lib/core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'

export class DataFieldDTO extends DTO {

    @Expect(DTO.String().allow('int32', 'int64', 'float', 'double').only().required())
    public type: 'int32' | 'int64' | 'float' | 'double'

    @Expect(DTO.String().required())
    public unit: string

    @Expect(DTO.String().allow('').optional().default(''))
    public description: string
}