/**
 * A change of a text: the characters removed at an offset, replaced by the text inserted. The files are changed by
 * their edits only, the rest of their text (its comments, its layout) kept
 */
export type TextEdit = {
    offset: number
    remove: number
    insert: string
}

/**
 * The text with its edits, applied from its end (the offsets of the edits are the ones of the original text)
 * @param text
 * @param edits
 */
export function applyEdits(text: string, edits: TextEdit[]): string {
    //From the end of the text; the edits at the same offset in their order (the last one applied first)
    const sorted: TextEdit[] = edits.map((edit: TextEdit, index: number): [TextEdit, number] => [edit, index])
        .sort((a: [TextEdit, number], b: [TextEdit, number]): number => b[0].offset - a[0].offset || b[1] - a[1])
        .map(([edit]: [TextEdit, number]): TextEdit => edit)
    let result: string = text
    for (const edit of sorted) result = result.slice(0, edit.offset) + edit.insert + result.slice(edit.offset + edit.remove)
    return result
}

/**
 * The indentation of the line of an offset
 * @param text
 * @param offset
 */
export function lineIndent(text: string, offset: number): string {
    const start: number = text.lastIndexOf('\n', offset - 1) + 1
    return /^[ \t]*/.exec(text.slice(start))![0]
}

/**
 * The unit of indentation of a text: the smallest indentation of its indented lines (two spaces by default)
 * @param text
 */
export function indentUnit(text: string): string {
    let unit: string | undefined
    for (const line of text.split('\n')) {
        const indent: string = /^[ \t]*/.exec(line)![0]
        if (!indent || indent.length === line.length) continue
        if (indent.startsWith('\t')) return '\t'
        if (unit === undefined || indent.length < unit.length) unit = indent
    }
    return unit ?? '  '
}

/**
 * The offset where a line starts
 * @param text
 * @param offset
 */
export function lineStart(text: string, offset: number): number {
    return text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * The offset of the end of a line (its newline, or the end of the text)
 * @param text
 * @param offset
 */
export function lineEndOf(text: string, offset: number): number {
    const end: number = text.indexOf('\n', offset)
    return end < 0 ? text.length : end
}

/**
 * An error of syntax at an offset of a file, telling its line and its column
 */
export class NativeSyntaxError extends Error {
    constructor(file: string, text: string, offset: number, message: string) {
        const line: number = text.slice(0, offset).split('\n').length
        const column: number = offset - lineStart(text, offset) + 1
        super(`${file}:${line}:${column}: ${message}`)
    }
}
