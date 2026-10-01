import {ValidateXML} from './internal/XMLValidator.js'

/**
 * Whether a string is a well formed XML document
 * @param string
 * @constructor
 */
export function IsXML(string: string): boolean {
    return typeof string === 'string' && ValidateXML(string)
}
