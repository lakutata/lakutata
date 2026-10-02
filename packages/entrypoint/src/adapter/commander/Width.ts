import {stripVTControlCharacters} from 'node:util'

/**
 * The wide characters of the terminals: the Chinese, Japanese and Korean ones, the full width forms
 */
const WIDE: string = '\\u1100-\\u115F\\u2E80-\\u303E\\u3041-\\u33FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uA000-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6\\u{20000}-\\u{3FFFD}'

/**
 * The punctuation which does not start a line
 */
const CLOSING: string = '、。，．：；！？）」』】〕〉》％,.:;!?)\\]}'

/**
 * The punctuation which does not end a line
 */
const OPENING: string = '（「『【〔〈《(\\[{'

const WIDE_CHARACTER: RegExp = new RegExp(`[${WIDE}]`, 'u')

/**
 * The chunks of a line the wrapping keeps whole: a word, or a wide character, with the punctuation opening and
 * closing it
 */
const CHUNK: RegExp = new RegExp(`\\s*[${OPENING}]*(?:[${WIDE}]|[^\\s${WIDE}]+)[${CLOSING}]*`, 'gu')

/**
 * The width of a text in a terminal, the wide characters taking two columns
 * @param text
 */
export function DisplayWidth(text: string): number {
    let width: number = 0
    for (const character of stripVTControlCharacters(text)) width += WIDE_CHARACTER.test(character) ? 2 : 1
    return width
}

/**
 * Wrap a text to a width, as commander does, the lines of wide characters wrapped between them
 * @param text
 * @param width
 * @param minimum the width under which the text is not wrapped
 */
export function BoxWrap(text: string, width: number, minimum: number = 40): string {
    if (width < minimum) return text
    const wrapped: string[] = []
    for (const line of text.split(/\r\n|\n/)) {
        const chunks: string[] | null = line.match(CHUNK)
        if (!chunks) {
            wrapped.push('')
            continue
        }
        let current: string = chunks.shift()!
        let currentWidth: number = DisplayWidth(current)
        for (const chunk of chunks) {
            const chunkWidth: number = DisplayWidth(chunk)
            if (currentWidth + chunkWidth <= width) {
                current += chunk
                currentWidth += chunkWidth
                continue
            }
            wrapped.push(current)
            //The space at the break removed
            current = chunk.trimStart()
            currentWidth = DisplayWidth(current)
        }
        wrapped.push(current)
    }
    return wrapped.join('\n')
}
