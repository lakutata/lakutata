import {DTO} from '../lib/dto/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {type PaginationMeta} from '../types/PaginationMeta.js'

export class PaginationResultDTO<T = any, U = T[]> extends DTO {
    @Expect(DTO.Array(DTO.Any()).required())
    public items: U

    @Expect(DTO.Object({
        count: DTO.Number().integer().positive().allow(0).required(),
        total: DTO.Number().integer().positive().allow(0).required(),
        limit: DTO.Number().integer().positive().allow(0).required(),
        offset: DTO.Number().integer().positive().allow(0).required()
    }).required())
    public meta: PaginationMeta
}