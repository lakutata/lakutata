import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'

export class PaginationSearchDTO extends DTO {
    @Expect(DTO.Number().integer().positive().allow(0).optional().default(10))
    public limit?: number

    @Expect(DTO.Number().integer().positive().allow(0).optional().default(0))
    public offset?: number
}