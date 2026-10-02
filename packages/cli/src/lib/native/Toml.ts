import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {ApplyEdits, LineEnd, LineIndent, NativeSyntaxError, type TextEdit} from './TextEdits.js'

/**
 * A value of TOML (1.0), with its place in the text
 */
export type TomlValue = TomlString | TomlArray | TomlInlineTable | TomlOther

type TomlBase = {
    start: number
    end: number
}

export type TomlString = TomlBase & {
    kind: 'string'
    value: string
}

export type TomlOther = TomlBase & {
    kind: 'other'
    text: string
}

export type TomlArray = TomlBase & {
    kind: 'array'
    items: TomlValue[]
    close: number
    trailingComma: boolean
}

export type TomlInlineTable = TomlBase & {
    kind: 'inline-table'
    entries: TomlEntry[]
}

/**
 * A key/value pair: its dotted key, its value
 */
export type TomlEntry = {
    key: string[]
    start: number
    value: TomlValue
}

/**
 * A table of the document: its header ([a.b], [[a]]; the root table has none), its key/value pairs
 */
export type TomlTable = {
    path: string[]
    array: boolean
    /**
     * The offset of its header, -1 for the root table
     */
    header: number
    headerEnd: number
    entries: TomlEntry[]
}

/**
 * The parser of TOML 1.0: the tables and the arrays of tables, the dotted and quoted keys, the basic and literal
 * strings (multiline too), the arrays (their comments and trailing commas), the inline tables, the other values
 * (numbers, booleans, dates) kept as their text
 */
class TomlParser {
    protected offset: number = 0

    constructor(protected readonly file: string, protected readonly text: string) {
    }

    protected error(message: string, offset: number = this.offset): never {
        throw new NativeSyntaxError(this.file, this.text, offset, message)
    }

    /**
     * Skip the spaces and tabs of a line
     */
    protected spaces(): void {
        while (this.text[this.offset] === ' ' || this.text[this.offset] === '\t') this.offset++
    }

    /**
     * Skip the whitespaces, the newlines and the comments (inside of the arrays)
     */
    protected blank(): void {
        for (; ;) {
            this.spaces()
            const char: string = this.text[this.offset]
            if (char === '\n' || char === '\r') this.offset++
            else if (char === '#') this.comment()
            else return
        }
    }

    protected comment(): void {
        while (this.offset < this.text.length && this.text[this.offset] !== '\n') this.offset++
    }

    /**
     * The end of a line: spaces, a comment, a newline (or the end of the text)
     */
    protected lineEnd(): void {
        this.spaces()
        if (this.text[this.offset] === '#') this.comment()
        if (this.text[this.offset] === '\r') this.offset++
        if (this.offset < this.text.length && this.text[this.offset] !== '\n') this.error('expected the end of the line')
        this.offset++
    }

    public parse(): TomlTable[] {
        const tables: TomlTable[] = [{path: [], array: false, header: -1, headerEnd: 0, entries: []}]
        for (; ;) {
            this.blank()
            if (this.offset >= this.text.length) return tables
            if (this.text[this.offset] === '[') {
                const header: number = this.offset
                const array: boolean = this.text[this.offset + 1] === '['
                this.offset += array ? 2 : 1
                this.spaces()
                const path: string[] = this.key()
                this.spaces()
                if (!this.text.startsWith(array ? ']]' : ']', this.offset)) this.error(`expected "${array ? ']]' : ']'}"`)
                this.offset += array ? 2 : 1
                const headerEnd: number = this.offset
                this.lineEnd()
                tables.push({path: path, array: array, header: header, headerEnd: headerEnd, entries: []})
            } else {
                tables.at(-1)!.entries.push(this.entry())
                this.lineEnd()
            }
        }
    }

    /**
     * A key: its parts, dotted (bare, basic or literal)
     */
    protected key(): string[] {
        const parts: string[] = []
        for (; ;) {
            const char: string = this.text[this.offset]
            if (char === '"' || char === '\'') {
                parts.push(this.string().value)
            } else {
                const bare: RegExpExecArray | null = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.offset))
                if (!bare) this.error('expected a key')
                parts.push(bare[0])
                this.offset += bare[0].length
            }
            this.spaces()
            if (this.text[this.offset] !== '.') return parts
            this.offset++
            this.spaces()
        }
    }

    protected entry(): TomlEntry {
        const start: number = this.offset
        const key: string[] = this.key()
        this.spaces()
        if (this.text[this.offset] !== '=') this.error('expected "="')
        this.offset++
        this.spaces()
        return {key: key, start: start, value: this.value()}
    }

    protected value(): TomlValue {
        const char: string | undefined = this.text[this.offset]
        if (char === '"' || char === '\'') return this.string()
        if (char === '[') return this.array()
        if (char === '{') return this.inlineTable()
        //The numbers, the booleans and the dates, their text
        const other: RegExpExecArray | null = /^[^\s,\]}#]+(?: [0-9:.+\-Z]+)?/.exec(this.text.slice(this.offset))
        if (!other) this.error(char === undefined ? 'unexpected end of the file' : `unexpected ${JSON.stringify(char)}`)
        const start: number = this.offset
        this.offset += other[0].length
        return {kind: 'other', text: other[0], start: start, end: this.offset}
    }

    protected string(): TomlString {
        const start: number = this.offset
        const quote: string = this.text[this.offset]
        const multiline: boolean = this.text.startsWith(quote.repeat(3), this.offset)
        const delimiter: string = multiline ? quote.repeat(3) : quote
        this.offset += delimiter.length
        //The newline right after the opening of a multiline string is not part of it
        if (multiline && this.text[this.offset] === '\n') this.offset++
        else if (multiline && this.text.startsWith('\r\n', this.offset)) this.offset += 2
        let value: string = ''
        for (; ;) {
            if (this.offset >= this.text.length) this.error('unterminated string', start)
            if (this.text.startsWith(delimiter, this.offset)) {
                //Up to two quotes before the closing ones are the end of the content of a multiline string ('''a''''')
                let extra: number = 0
                while (multiline && extra < 2 && this.text[this.offset + delimiter.length + extra] === quote) extra++
                value += quote.repeat(extra)
                this.offset += delimiter.length + extra
                return {kind: 'string', value: value, start: start, end: this.offset}
            }
            const char: string = this.text[this.offset]
            if (!multiline && char === '\n') this.error('unterminated string', start)
            if (char === '\\' && quote === '"') {
                const next: string = this.text[this.offset + 1] ?? ''
                if (multiline && /[ \t\r\n]/.test(next)) {
                    //A line ending backslash: the whitespaces and newlines after it trimmed
                    this.offset++
                    while (/[ \t\r\n]/.test(this.text[this.offset] ?? '')) this.offset++
                    continue
                }
                const escapes: Record<string, string> = {'b': '\b', 't': '\t', 'n': '\n', 'f': '\f', 'r': '\r', 'e': '\x1b', '"': '"', '\\': '\\'}
                if (next in escapes) {
                    value += escapes[next]
                    this.offset += 2
                } else if (next === 'u' || next === 'U' || next === 'x') {
                    const length: number = next === 'u' ? 4 : next === 'U' ? 8 : 2
                    value += String.fromCodePoint(parseInt(this.text.slice(this.offset + 2, this.offset + 2 + length), 16))
                    this.offset += 2 + length
                } else {
                    this.error(`invalid escape "\\${next}"`)
                }
                continue
            }
            value += char
            this.offset++
        }
    }

    protected array(): TomlArray {
        const start: number = this.offset
        this.offset++
        const items: TomlValue[] = []
        let trailingComma: boolean = false
        for (; ;) {
            this.blank()
            if (this.text[this.offset] === ']') break
            items.push(this.value())
            trailingComma = false
            this.blank()
            if (this.text[this.offset] === ',') {
                this.offset++
                trailingComma = true
            } else if (this.text[this.offset] !== ']') {
                this.error('expected "," or "]"')
            }
        }
        const close: number = this.offset
        this.offset++
        return {kind: 'array', items: items, start: start, end: this.offset, close: close, trailingComma: trailingComma}
    }

    protected inlineTable(): TomlInlineTable {
        const start: number = this.offset
        this.offset++
        const entries: TomlEntry[] = []
        for (; ;) {
            this.blank()
            if (this.text[this.offset] === '}') break
            entries.push(this.entry())
            this.blank()
            if (this.text[this.offset] === ',') this.offset++
            else if (this.text[this.offset] !== '}') this.error('expected "," or "}"')
        }
        this.offset++
        return {kind: 'inline-table', entries: entries, start: start, end: this.offset}
    }
}

/**
 * A key of TOML: bare when it can be, otherwise literal ('…'), or basic ("…") when it has a quote
 * @param key
 */
export function TomlKey(key: string): string {
    if (/^[A-Za-z0-9_-]+$/.test(key)) return key
    return key.includes('\'') ? JSON.stringify(key) : `'${key}'`
}

/**
 * A string of TOML (basic)
 * @param value
 */
export function TomlStringText(value: string): string {
    return JSON.stringify(value)
}

/**
 * A document of TOML (.cargo/config.toml), parsed with the places of its tables and values: it is changed by edits of
 * its text, its comments and its layout kept
 */
export class TomlDocument {
    public readonly tables: TomlTable[]
    protected readonly edits: TextEdit[] = []

    constructor(public readonly file: string, public readonly text: string) {
        this.tables = new TomlParser(file, text).parse()
    }

    /**
     * The document of a file (empty when it does not exist)
     * @param file
     */
    public static async read(file: string): Promise<TomlDocument> {
        return new TomlDocument(file, existsSync(file) ? await readFile(file, 'utf8') : '')
    }

    public get changes(): TextEdit[] {
        return this.edits
    }

    public applied(): TomlDocument {
        return new TomlDocument(this.file, ApplyEdits(this.text, this.edits))
    }

    /**
     * The table of a path (not an array of tables)
     * @param path
     */
    public table(path: string[]): TomlTable | undefined {
        return this.tables.find((candidate: TomlTable): boolean => !candidate.array && candidate.path.length === path.length && candidate.path.every((part: string, index: number): boolean => part === path[index]))
    }

    /**
     * The string of a key of a table
     * @param path the path of the table
     * @param key
     */
    public string(path: string[], key: string): string | undefined {
        const value: TomlValue | undefined = this.table(path)?.entries.find((entry: TomlEntry): boolean => entry.key.length === 1 && entry.key[0] === key)?.value
        if (value && value.kind !== 'string') throw new NativeSyntaxError(this.file, this.text, value.start, `"${key}" is not a string`)
        return value?.value
    }

    /**
     * Add values to a list in a string of a table, its items separated by a separator (the table and the key created
     * when missing); the values already in it are skipped
     * @param path the path of the table
     * @param key
     * @param values
     * @param separator
     * @return whether the document is changed
     */
    public addToStringList(path: string[], key: string, values: string[], separator: string): boolean {
        const current: string | undefined = this.string(path, key)
        const items: string[] = current === undefined ? [] : current.split(separator).filter((item: string): boolean => item.trim() !== '')
        const missing: string[] = values.filter((value: string, index: number): boolean => !items.includes(value) && values.indexOf(value) === index)
        if (!missing.length) return false
        const rendered: string = TomlStringText([...items, ...missing].join(separator))
        const table: TomlTable | undefined = this.table(path)
        if (!table) {
            const blank: string = !this.text.length ? '' : this.text.endsWith('\n\n') ? '' : this.text.endsWith('\n') ? '\n' : '\n\n'
            this.edits.push({offset: this.text.length, remove: 0, insert: `${blank}[${path.map(TomlKey).join('.')}]\n${TomlKey(key)} = ${rendered}\n`})
            return true
        }
        const entry: TomlEntry | undefined = table.entries.find((candidate: TomlEntry): boolean => candidate.key.length === 1 && candidate.key[0] === key)
        if (entry) {
            this.edits.push({offset: entry.value.start, remove: entry.value.end - entry.value.start, insert: rendered})
            return true
        }
        //After the last entry of the table, or its header
        const last: TomlEntry | undefined = table.entries.at(-1)
        const after: number = LineEnd(this.text, last ? last.value.end : table.headerEnd)
        const indent: string = last ? LineIndent(this.text, last.start) : ''
        this.edits.push(after < this.text.length
            ? {offset: after, remove: 0, insert: `\n${indent}${TomlKey(key)} = ${rendered}`}
            : {offset: after, remove: 0, insert: `${this.text.endsWith('\n') ? '' : '\n'}${indent}${TomlKey(key)} = ${rendered}\n`})
        return true
    }
}
