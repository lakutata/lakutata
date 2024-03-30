import * as koffi from './lib/index.js'
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
