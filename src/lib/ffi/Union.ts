import * as koffi from 'koffi'
import {TypeSpec} from './types/TypeSpec.js'

/**
 * @see https://koffi.dev/unions#output-unions
 */
export class Union extends koffi.Union {
    constructor(type: TypeSpec) {
        super(type)
    }

    [s: string]: any
}
