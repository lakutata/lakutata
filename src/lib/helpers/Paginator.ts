import {PaginationSearchDTO} from '../../dto/PaginationSearchDTO.js'
import {PaginationResultDTO} from '../../dto/PaginationResultDTO.js'

export interface PaginatorHandlerResult<T> {
    total: number
    items: T[]
}

/**
 * Paginator
 * @param options
 * @param handler
 * @constructor
 */
export async function Paginator<T, Options extends PaginationSearchDTO>(options: Options, handler: (options: Options, limit: number, offset: number) => Promise<PaginatorHandlerResult<T[]>>): Promise<PaginationResultDTO<T[]>> {
    const result: PaginatorHandlerResult<T[]> = await handler(options, options.limit!, options.offset!)
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