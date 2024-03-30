import * as koffi from './lib/index.js'
import {TypeSpec} from './types/TypeSpec.js'

/**
 * Get the size of a type
 * @param type
 * @constructor
 */
export function SizeOf(type: TypeSpec): number {
    return koffi.sizeof(type)
}
