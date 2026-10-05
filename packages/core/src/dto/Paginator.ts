import {PaginationSearchDTO} from './PaginationSearchDTO.js'
import {PaginationResultDTO} from './PaginationResultDTO.js'

/**
 * What the handler of `paginator()` returns: a page of items, and the size of the whole result.
 */
export interface PaginatorHandlerResult<T> {
    /**
     * The number of items of the whole result, across all the pages.
     */
    total: number
    /**
     * The items of the page.
     */
    items: T[]
}

/**
 * Fetch a page of items with a handler, and build the paginated result: the items, with the page metadata (`count`
 * the number of items returned, `total` the handler's total, and the `limit` and `offset` of the search). It does not
 * validate the search: pass a validated `PaginationSearchDTO` (the input of an action, or a constructed DTO), whose
 * `limit` and `offset` have their defaults (10 and 0).
 * @param options The search, a `PaginationSearchDTO` or a subclass carrying the search criteria.
 * @param handler A function receiving the limit, the offset and the whole search, and resolving to the page of items
 * and the total; its rejection rejects the paginator.
 * @returns A promise of the paginated result (a plain object shaped as `PaginationResultDTO`).
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {PaginationResultDTO, PaginationSearchDTO, paginator} from 'lakutata/dtos'
 *
 * class UserSearchDTO extends PaginationSearchDTO {
 *     @Expect(DTO.String().optional())
 *     public name?: string
 * }
 *
 * interface User {
 *     id: number
 *     name: string
 * }
 *
 * declare const db: {
 *     countUsers(name?: string): Promise<number>
 *     findUsers(name: string | undefined, limit: number, offset: number): Promise<User[]>
 * }
 *
 * export async function SearchUsers(input: Record<string, unknown>): Promise<PaginationResultDTO<User>> {
 *     return await paginator(new UserSearchDTO(input), async (limit: number, offset: number, search: UserSearchDTO) => ({
 *         total: await db.countUsers(search.name),
 *         items: await db.findUsers(search.name, limit, offset)
 *     }))
 * }
 * ```
 */
export async function paginator<Options extends PaginationSearchDTO, T>(options: Options, handler: (limit: number, offset: number, options: Options) => Promise<PaginatorHandlerResult<T>>): Promise<PaginationResultDTO<T>> {
    const result: PaginatorHandlerResult<T> = await handler(options.limit!, options.offset!, options)
    return {
        items: result.items,
        meta: {
            count: result.items.length,
            total: result.total,
            limit: options.limit!,
            offset: options.offset!
        }
    }
}