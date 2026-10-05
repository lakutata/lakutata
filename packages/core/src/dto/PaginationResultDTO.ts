import {DTO} from '../lib/dto/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {type PaginationMeta} from '../types/PaginationMeta.js'

/**
 * The result of a paginated search: the items of the page, and where the page is in the whole result. `paginator()`
 * builds it; use it with `@Return` to validate the result of a paginated action.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Return} from 'lakutata/decorator/dto'
 * import {PaginationResultDTO} from 'lakutata/dtos'
 *
 * class Tags extends Component {
 *     protected readonly tags: string[] = ['red', 'green', 'blue']
 *
 *     @Return(PaginationResultDTO)
 *     public async list(limit: number, offset: number): Promise<PaginationResultDTO<string>> {
 *         const items: string[] = this.tags.slice(offset, offset + limit)
 *         return {items: items, meta: {count: items.length, total: this.tags.length, limit: limit, offset: offset}}
 *     }
 * }
 * ```
 */
export class PaginationResultDTO<T = any, U = T[]> extends DTO {
    /**
     * The items of the page (an array; its items are not validated).
     */
    @Expect(DTO.Array(DTO.Any()).required())
    public items: U

    /**
     * Where the page is: `count` the number of items of the page, `total` the number of items of the whole result,
     * `limit` and `offset` those of the search. All integers, 0 or more.
     */
    @Expect(DTO.Object({
        count: DTO.Number().integer().positive().allow(0).required(),
        total: DTO.Number().integer().positive().allow(0).required(),
        limit: DTO.Number().integer().positive().allow(0).required(),
        offset: DTO.Number().integer().positive().allow(0).required()
    }).required())
    public meta: PaginationMeta
}