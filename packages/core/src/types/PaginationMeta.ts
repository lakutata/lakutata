/**
 * The pagination of a result (PaginationResultDTO)
 */
export type PaginationMeta = {
    /**
     * The number of the items of the page
     */
    count: number
    /**
     * The number of the items of all the pages
     */
    total: number
    /**
     * The maximum number of the items of a page
     */
    limit: number
    /**
     * The number of the items before the page
     */
    offset: number
}
