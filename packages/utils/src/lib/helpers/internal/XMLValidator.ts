/**
 * Derived from src/validator.js and src/util.js of fast-xml-parser 4.5.3 (MIT, see THIRD_PARTY_NOTICES.md): its
 * validation with the boolean attributes allowed and no unpaired tag, giving whether the document is valid (the
 * errors, their messages and their positions are not computed). Fixed: a self closing root element closes the root, so
 * a text or an element after it is invalid (the upstream accepts them), and an XML declaration is invalid anywhere but at
 * the start of the document (the upstream detects it before the first element only)
 */

const NAME_START_CHAR: string = ':A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD'

const NAME_CHAR: string = NAME_START_CHAR + '\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040'

//The ranges of code points of the XML names, the joiners (U+200C-U+200D) and the combining marks included
// eslint-disable-next-line no-misleading-character-class
const NAME: RegExp = new RegExp('^[' + NAME_START_CHAR + '][' + NAME_CHAR + ']*$')

/**
 * Every attribute of an attribute string, valid or not
 */
const ATTRIBUTE: RegExp = /(\s*)([^\s=]+)(\s*=)?(\s*(['"])([\s\S]*?)\5)?/g

/**
 * The index returned by the readers when the document is invalid
 */
const INVALID: number = -1

/**
 * Whether a character is a white space
 * @param char
 */
function IsWhiteSpace(char: string | undefined): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/**
 * Whether a string is a name of tag or of attribute
 * @param name
 */
function IsName(name: string): boolean {
    return NAME.test(name)
}

/**
 * Skip a processing instruction, from the character after "<?"
 * @param xml
 * @param i
 * @returns the index of its end, INVALID for an XML declaration which is not at the start of the document
 */
function ReadProcessingInstruction(xml: string, i: number): number {
    const start: number = i
    for (; i < xml.length; i++) {
        if (xml[i] === '?' || xml[i] === ' ') {
            const target: string = xml.substring(start, i)
            if (i > 5 && target === 'xml') return INVALID
            if (xml[i] === '?' && xml[i + 1] === '>') {
                i++
                break
            }
        }
    }
    return i
}

/**
 * Skip a comment, a DOCTYPE or a CDATA section, from the character "!"
 * @param xml
 * @param i
 * @returns the index of its end
 */
function ReadCommentAndCDATA(xml: string, i: number): number {
    if (xml.length > i + 5 && xml[i + 1] === '-' && xml[i + 2] === '-') {
        for (i += 3; i < xml.length; i++) {
            if (xml[i] === '-' && xml[i + 1] === '-' && xml[i + 2] === '>') {
                i += 2
                break
            }
        }
    } else if (xml.length > i + 8 && xml.startsWith('DOCTYPE', i + 1)) {
        let angleBrackets: number = 1
        for (i += 8; i < xml.length; i++) {
            if (xml[i] === '<') {
                angleBrackets++
            } else if (xml[i] === '>') {
                angleBrackets--
                if (angleBrackets === 0) break
            }
        }
    } else if (xml.length > i + 9 && xml.startsWith('[CDATA[', i + 1)) {
        for (i += 8; i < xml.length; i++) {
            if (xml[i] === ']' && xml[i + 1] === ']' && xml[i + 2] === '>') {
                i += 2
                break
            }
        }
    }
    return i
}

/**
 * Read the attributes of a tag until its ">" (not in a quoted value)
 * @param xml
 * @param i
 * @returns undefined when a quote is not closed
 */
function ReadAttributes(xml: string, i: number): { value: string, index: number, tagClosed: boolean } | undefined {
    const start: number = i
    let quote: string = ''
    let tagClosed: boolean = false
    for (; i < xml.length; i++) {
        const char: string = xml[i]
        if (char === '"' || char === '\'') {
            //A value quoted with double quotes may contain single quotes, and the reverse
            if (quote === '') {
                quote = char
            } else if (quote === char) {
                quote = ''
            }
        } else if (char === '>' && quote === '') {
            tagClosed = true
            break
        }
    }
    if (quote !== '') return undefined
    return {value: xml.substring(start, i), index: i, tagClosed: tagClosed}
}

/**
 * Whether the attributes of a tag are valid: separated, with a value when "=" is given, with valid and unique names
 * @param attributes
 */
function ValidateAttributes(attributes: string): boolean {
    const names: Set<string> = new Set()
    ATTRIBUTE.lastIndex = 0
    for (let match: RegExpExecArray | null = ATTRIBUTE.exec(attributes); match; match = ATTRIBUTE.exec(attributes)) {
        //No space before the attribute (a="1"b="2"), or "=" without value
        if (match[1].length === 0 || (match[3] !== undefined && match[4] === undefined)) return false
        if (!IsName(match[2]) || names.has(match[2])) return false
        names.add(match[2])
    }
    return true
}

/**
 * Skip a character reference (&#10; or &#xA;), from the character after "&#"
 * @param xml
 * @param i
 * @returns the index of its ";", INVALID when it is not a reference
 */
function ReadNumericReference(xml: string, i: number): number {
    let digit: RegExp = /\d/
    if (xml[i] === 'x') {
        i++
        digit = /[\da-fA-F]/
    }
    for (; i < xml.length; i++) {
        if (xml[i] === ';') return i
        if (!digit.test(xml[i])) break
    }
    return INVALID
}

/**
 * Skip an entity or a character reference, from its "&"
 * @param xml
 * @param i
 * @returns the index of its ";", INVALID when it is not a reference
 */
function ReadReference(xml: string, i: number): number {
    i++
    if (xml[i] === ';') return INVALID
    if (xml[i] === '#') return ReadNumericReference(xml, i + 1)
    for (let count: number = 0; i < xml.length; i++, count++) {
        if (/\w/.test(xml[i]) && count < 20) continue
        if (xml[i] === ';') break
        return INVALID
    }
    return i
}

/**
 * Whether a string is a well formed XML document (one root element, closed and nested tags, valid names and
 * attributes, references, comments, CDATA sections, DOCTYPE and processing instructions)
 * @param xml
 * @constructor
 */
export function ValidateXML(xml: string): boolean {
    //The tags opened and not closed yet
    const tags: string[] = []
    let tagFound: boolean = false
    //Whether the root element is closed
    let reachedRoot: boolean = false
    //A byte order mark
    if (xml[0] === '﻿') xml = xml.substring(1)
    for (let i: number = 0; i < xml.length; i++) {
        if (xml[i] === '<' && xml[i + 1] === '?') {
            i = ReadProcessingInstruction(xml, i + 2)
            if (i === INVALID) return false
        } else if (xml[i] === '<') {
            i++
            if (xml[i] === '!') {
                i = ReadCommentAndCDATA(xml, i)
                continue
            }
            let closingTag: boolean = false
            if (xml[i] === '/') {
                closingTag = true
                i++
            }
            //The name of the tag
            const nameStart: number = i
            while (i < xml.length && xml[i] !== '>' && !IsWhiteSpace(xml[i])) i++
            let tagName: string = xml.substring(nameStart, i).trim()
            if (tagName[tagName.length - 1] === '/') {
                //A self closing tag without attribute
                tagName = tagName.substring(0, tagName.length - 1)
                i--
            }
            if (!IsName(tagName)) return false
            const read: { value: string, index: number, tagClosed: boolean } | undefined = ReadAttributes(xml, i)
            if (!read) return false
            let attributes: string = read.value
            i = read.index
            if (attributes[attributes.length - 1] === '/') {
                //A self closing tag
                attributes = attributes.substring(0, attributes.length - 1)
                if (!ValidateAttributes(attributes)) return false
                //A second root element (the upstream does not check it for a self closing tag)
                if (reachedRoot) return false
                //A self closing root element is the whole root (the upstream accepts anything after it)
                if (tags.length === 0) reachedRoot = true
                tagFound = true
            } else if (closingTag) {
                if (!read.tagClosed || attributes.trim().length > 0 || tags.length === 0) return false
                if (tags.pop() !== tagName) return false
                if (tags.length === 0) reachedRoot = true
            } else {
                if (!ValidateAttributes(attributes)) return false
                //A second root element
                if (reachedRoot) return false
                tags.push(tagName)
                tagFound = true
            }
            //The text after the tag, with its comments, CDATA sections, processing instructions and references
            for (i++; i < xml.length; i++) {
                if (xml[i] === '<') {
                    if (xml[i + 1] === '!') {
                        i = ReadCommentAndCDATA(xml, i + 1)
                        continue
                    } else if (xml[i + 1] === '?') {
                        //From the target, as at the top level (the upstream reads it from the "?", so a misplaced XML
                        //declaration in an element or after the root is not detected)
                        i = ReadProcessingInstruction(xml, i + 2)
                        if (i === INVALID) return false
                    } else {
                        break
                    }
                } else if (xml[i] === '&') {
                    i = ReadReference(xml, i)
                    if (i === INVALID) return false
                } else if (reachedRoot && !IsWhiteSpace(xml[i])) {
                    //Text after the root element
                    return false
                }
            }
            if (xml[i] === '<') i--
        } else if (!IsWhiteSpace(xml[i])) {
            return false
        }
    }
    //A root element, closed
    return tagFound && tags.length === 0
}
