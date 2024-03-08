import {XMLValidator} from 'fast-xml-parser'

/**
 * Whether string is XML
 * @param string
 * @constructor
 */
export function IsXML(string: string): boolean {
    try {
        XMLValidator.validate(string, {
            allowBooleanAttributes: true
        })
        return true
    } catch (e) {
        return false
    }
}
