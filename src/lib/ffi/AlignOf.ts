import * as koffi from './lib/index.js'
import {TypeSpec} from './types/TypeSpec.js'

/**
 * Get the alignment of a type
 * @param type
 * @constructor
 */
export function AlignOf(type: TypeSpec): number {
    return koffi.alignof(type)
}
