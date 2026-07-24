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
export async function Paginator<Options extends PaginationSearchDTO, T>(options: Options, handler: (limit: number, offset: number, options: Options) => Promise<PaginatorHandlerResult<T>>): Promise<PaginationResultDTO<T>> {
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