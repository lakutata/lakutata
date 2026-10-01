import {Reference} from './Reference.js'

export interface ArraySortOptions {
    /**
     * @default 'ascending'
     */
    order?: 'ascending' | 'descending'
    by?: string | Reference
}
