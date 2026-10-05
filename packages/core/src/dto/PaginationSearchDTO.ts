import {DTO} from '../lib/dto/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'

/**
 * The input of a paginated search: how many items to return and how many to skip. Extend it with the search criteria,
 * and pass the validated input to `paginator()`.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {PaginationSearchDTO} from 'lakutata/dtos'
 *
 * //Searching the users by name, a page at a time
 * export class UserSearchDTO extends PaginationSearchDTO {
 *     @Expect(DTO.String().optional())
 *     public name?: string
 * }
 *
 * //limit 10 and offset 0 by default
 * const search: UserSearchDTO = new UserSearchDTO({name: 'ada'})
 * console.log(search.limit, search.offset)
 * ```
 */
export class PaginationSearchDTO extends DTO {
    /**
     * The maximum number of items to return: an integer, 0 or more.
     * @default 10
     */
    @Expect(DTO.Number().integer().positive().allow(0).optional().default(10))
    public limit?: number

    /**
     * The number of items to skip before the first one returned: an integer, 0 or more.
     * @default 0
     */
    @Expect(DTO.Number().integer().positive().allow(0).optional().default(0))
    public offset?: number
}