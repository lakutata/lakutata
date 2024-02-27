import {DataValidator, DefaultValidationOptions} from '../internal/DataValidator.js'

/**
 * Whether input value is symbol
 * @param inp
 * @constructor
 */
export function IsSymbol(inp: any): boolean {
    return DataValidator.isValid(inp, DataValidator.Symbol().strict(true), DefaultValidationOptions)
}
