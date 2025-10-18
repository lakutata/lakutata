import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'

export class PaginationResultDTO<T = any> extends DTO {
    @Expect(DTO.Array(DTO.Any()).required())
    public items: T[]

    @Expect(DTO.Object({
        count: DTO.Number().integer().positive().allow(0).required(),
        total: DTO.Number().integer().positive().allow(0).required(),
        limit: DTO.Number().integer().positive().allow(0).required(),
        offset: DTO.Number().integer().positive().allow(0).required()
    }).required())
    public meta: {
        count: number
        total: number
        limit: number
        offset: number
    }
}