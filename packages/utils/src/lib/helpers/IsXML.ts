import {validateXML} from './internal/XMLValidator.js'

/**
 * Tell whether a string is a well-formed XML document: one root element, every tag closed and nested properly, with an
 * optional XML declaration, comments and processing instructions; the spaces around the document are allowed. It is
 * not validated against a schema or a DTD. An HTML5 page with void elements (`<br>`) is not well-formed XML, and
 * neither is a fragment with several roots (`<a/><b/>`).
 * @param string The string to test; a value which is not a string gives `false`.
 * @returns `true` when the string is well-formed XML, `false` otherwise (an empty string included).
 * @example
 * ```typescript
 * import {isXML} from 'lakutata/utils'
 *
 * console.log(isXML('<?xml version="1.0"?><note><to>Ann</to></note>'), isXML('<a><b></a>'), isXML('Hello'))
 * //true false false
 * ```
 */
export function isXML(string: string): boolean {
    return typeof string === 'string' && validateXML(string)
}
