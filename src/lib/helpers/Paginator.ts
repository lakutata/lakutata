import {PaginationSearchDTO} from '../../dto/PaginationSearchDTO.js'
import {PaginationResultDTO} from '../../dto/PaginationResultDTO.js'

/**
 * Paginator
 * @param options
 * @param handler
 * @constructor
 */
export async function Paginator<T, Options extends PaginationSearchDTO, Result extends PaginationResultDTO<T>>(options: Options, handler: (options: Options, limit: number, offset: number) => Promise<Result>): Promise<Result> {
    return await handler(options, options.limit!, options.offset!)
}