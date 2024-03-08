import {DTO} from '../../core/DTO.js'

/**
 * Whether input value is symbol
 * @param inp
 * @constructor
 */
export function IsSymbol(inp: any): boolean {
    return DTO.isValid(inp, DTO.Symbol().strict(true))
}
