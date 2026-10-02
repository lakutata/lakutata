import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {ApplyEdits, IndentUnit, LineEnd, LineIndent, NativeSyntaxError, type TextEdit} from './TextEdits.js'

/**
 * A value of a gyp file: the Python literals gyp evaluates (its dictionaries, lists, strings and numbers; gyp
 * evaluates the file with the ast of Python, see gyp/pylib/gyp/input.py), with its place in the text
 */
export type GypNode = GypDict | GypList | GypString | GypOther

type GypBase = {
    /**
     * The offset of its first character
     */
    start: number
    /**
     * The offset after its last character
     */
    end: number
}

export type GypString = GypBase & {
    kind: 'string'
    value: string
}

export type GypOther = GypBase & {
    kind: 'other'
    text: string
}

export type GypList = GypBase & {
    kind: 'list'
    items: GypNode[]
    /**
     * The offset of the closing bracket
     */
    close: number
    /**
     * Whether its last item is followed by a comma
     */
    trailingComma: boolean
}

export type GypEntry = {
    key: GypString
    value: GypNode
}

export type GypDict = GypBase & {
    kind: 'dict'
    entries: GypEntry[]
    /**
     * The offset of the closing brace
     */
    close: number
    trailingComma: boolean
}

/**
 * The parser of the Python literals of the gyp files: comments (#), strings ('', "", ''' ''', """ """, the prefixes r,
 * u, b, the adjacent strings concatenated as Python does), numbers, names (True, False, None), lists, tuples and
 * dictionaries, their trailing commas
 */
class GypParser {
    protected offset: number = 0

    constructor(protected readonly file: string, protected readonly text: string) {
    }

    protected error(message: string, offset: number = this.offset): never {
        throw new NativeSyntaxError(this.file, this.text, offset, message)
    }

    /**
     * Skip the whitespaces, the line continuations and the comments
     */
    protected skip(): void {
        for (; ;) {
            const char: string = this.text[this.offset]
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f') {
                this.offset++
            } else if (char === '\\' && (this.text[this.offset + 1] === '\n' || this.text.startsWith('\r\n', this.offset + 1))) {
                this.offset += this.text[this.offset + 1] === '\n' ? 2 : 3
            } else if (char === '#') {
                while (this.offset < this.text.length && this.text[this.offset] !== '\n') this.offset++
            } else {
                return
            }
        }
    }

    public parse(): GypNode {
        this.skip()
        const node: GypNode = this.value()
        this.skip()
        if (this.offset < this.text.length) this.error('unexpected text after the value')
        return node
    }

    protected value(): GypNode {
        const char: string | undefined = this.text[this.offset]
        if (char === '{') return this.dict()
        if (char === '[') return this.list(']')
        if (char === '(') return this.list(')')
        if (char === '"' || char === '\'' || (/[rRuUbB]/.test(char ?? '') && /^[rRuUbB]{1,2}['"]/.test(this.text.slice(this.offset, this.offset + 3)))) return this.strings()
        const other: RegExpExecArray | null = /^(?:[+-]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?)|True|False|None)/.exec(this.text.slice(this.offset))
        if (!other) this.error(char === undefined ? 'unexpected end of the file' : `unexpected ${JSON.stringify(char)}`)
        const start: number = this.offset
        this.offset += other[0].length
        return {kind: 'other', text: other[0], start: start, end: this.offset}
    }

    /**
     * A string, and the strings adjacent to it (concatenated)
     */
    protected strings(): GypString {
        const start: number = this.offset
        let value: string = this.string()
        for (; ;) {
            const before: number = this.offset
            this.skip()
            const char: string | undefined = this.text[this.offset]
            if (char === '"' || char === '\'' || /^[rRuUbB]{1,2}['"]/.test(this.text.slice(this.offset, this.offset + 3))) {
                value += this.string()
            } else {
                this.offset = before
                break
            }
        }
        return {kind: 'string', value: value, start: start, end: this.offset}
    }

    /**
     * One string literal
     */
    protected string(): string {
        const prefix: string = /^[rRuUbB]{0,2}/.exec(this.text.slice(this.offset))![0]
        const raw: boolean = /[rR]/.test(prefix)
        this.offset += prefix.length
        const quote: string = this.text[this.offset]
        const triple: boolean = this.text.startsWith(quote.repeat(3), this.offset)
        const delimiter: string = triple ? quote.repeat(3) : quote
        const start: number = this.offset
        this.offset += delimiter.length
        let value: string = ''
        for (; ;) {
            if (this.offset >= this.text.length) this.error('unterminated string', start)
            if (this.text.startsWith(delimiter, this.offset)) {
                this.offset += delimiter.length
                return value
            }
            const char: string = this.text[this.offset]
            if (char === '\n' && !triple) this.error('unterminated string', start)
            if (char === '\\') {
                const next: string = this.text[this.offset + 1] ?? ''
                if (raw) {
                    value += char + next
                } else {
                    const escapes: Record<string, string> = {'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', '\'': '\'', '"': '"', '\n': '', 'a': '\x07', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}
                    value += next in escapes ? escapes[next] : char + next
                }
                this.offset += 2
                continue
            }
            value += char
            this.offset++
        }
    }

    protected list(close: string): GypList {
        const start: number = this.offset
        this.offset++
        const items: GypNode[] = []
        let trailingComma: boolean = false
        for (; ;) {
            this.skip()
            if (this.text[this.offset] === close) break
            items.push(this.value())
            trailingComma = false
            this.skip()
            if (this.text[this.offset] === ',') {
                this.offset++
                trailingComma = true
            } else if (this.text[this.offset] !== close) {
                this.error(`expected "," or "${close}"`)
            }
        }
        const closeOffset: number = this.offset
        this.offset++
        return {kind: 'list', items: items, start: start, end: this.offset, close: closeOffset, trailingComma: trailingComma}
    }

    protected dict(): GypDict {
        const start: number = this.offset
        this.offset++
        const entries: GypEntry[] = []
        let trailingComma: boolean = false
        for (; ;) {
            this.skip()
            if (this.text[this.offset] === '}') break
            const key: GypNode = this.value()
            if (key.kind !== 'string') this.error('the keys of gyp are strings', key.start)
            this.skip()
            if (this.text[this.offset] !== ':') this.error('expected ":"')
            this.offset++
            this.skip()
            const value: GypNode = this.value()
            entries.push({key: key, value: value})
            trailingComma = false
            this.skip()
            if (this.text[this.offset] === ',') {
                this.offset++
                trailingComma = true
            } else if (this.text[this.offset] !== '}') {
                this.error('expected "," or "}"')
            }
        }
        const closeOffset: number = this.offset
        this.offset++
        return {kind: 'dict', entries: entries, start: start, end: this.offset, close: closeOffset, trailingComma: trailingComma}
    }
}

/**
 * A gyp file (binding.gyp, a .gypi), parsed with the places of its values: it is changed by edits of its text, its
 * comments and its layout kept
 */
export class GypDocument {
    public readonly root: GypDict
    public readonly indent: string
    /**
     * The quote of the strings of the file (the most used one)
     */
    public readonly quote: string
    protected readonly edits: TextEdit[] = []

    constructor(public readonly file: string, public readonly text: string) {
        const root: GypNode = new GypParser(file, text).parse()
        if (root.kind !== 'dict') throw new NativeSyntaxError(file, text, root.start, 'a gyp file is a dictionary')
        this.root = root
        this.indent = IndentUnit(text)
        const strings: string[] = text.match(/(?<![\w\\])['"]/g) ?? []
        this.quote = strings.filter((quote: string): boolean => quote === '"').length > strings.filter((quote: string): boolean => quote === '\'').length ? '"' : '\''
    }

    public static async read(file: string): Promise<GypDocument> {
        return new GypDocument(file, await readFile(file, 'utf8'))
    }

    /**
     * The edits of the changes made
     */
    public get changes(): TextEdit[] {
        return this.edits
    }

    /**
     * A string of the file, in its quote
     * @param value
     */
    public literal(value: string): string {
        const escaped: string = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
        //The other quote when the value has the quote of the file only (OS=="mac": 'OS=="mac"')
        const quote: string = escaped.includes(this.quote) && !escaped.includes(this.quote === '"' ? '\'' : '"') ? (this.quote === '"' ? '\'' : '"') : this.quote
        return quote === '"' ? `"${escaped.replace(/"/g, '\\"')}"` : `'${escaped.replace(/'/g, '\\\'')}'`
    }

    /**
     * The value of a key of a dictionary
     * @param dict
     * @param key
     */
    public static get(dict: GypDict, key: string): GypNode | undefined {
        //A key repeated is the last one (as the dictionaries of Python, gyp evaluating its files)
        return [...dict.entries].reverse().find((entry: GypEntry): boolean => entry.key.value === key)?.value
    }

    /**
     * The text of a value, indented for its place (the lines after the first one)
     * @param value
     * @param indent the indentation of its line
     */
    protected render(value: unknown, indent: string): string {
        if (typeof value === 'string') return this.literal(value)
        const inner: string = indent + this.indent
        if (Array.isArray(value)) {
            if (!value.length) return '[]'
            //A condition as gyp writes it: ['OS=="mac"', {, its entries indented once, }] (on lines of its own when empty)
            if (value.length === 2 && typeof value[0] === 'string' && value[1] !== null && typeof value[1] === 'object' && !Array.isArray(value[1])) {
                const entries: [string, unknown][] = Object.entries(value[1] as Record<string, unknown>)
                return `[${this.literal(value[0])}, {\n${entries.map(([key, item]: [string, unknown]): string => `${inner}${this.literal(key)}: ${this.render(item, inner)},\n`).join('').replace(/,\n$/, '\n')}${indent}}]`
            }
            //The lists of strings on one line, the other ones a value per line
            if (value.every((item: unknown): boolean => typeof item === 'string')) return `[${value.map((item: unknown): string => this.render(item, inner)).join(', ')}]`
            return `[\n${value.map((item: unknown): string => `${inner}${this.render(item, inner)}`).join(',\n')}\n${indent}]`
        }
        const entries: [string, unknown][] = Object.entries(value as Record<string, unknown>)
        if (!entries.length) return '{}'
        return `{\n${entries.map(([key, item]: [string, unknown]): string => `${inner}${this.literal(key)}: ${this.render(item, inner)}`).join(',\n')}\n${indent}}`
    }

    /**
     * Insert items at the end of a list or of a dictionary (their texts): after its last item, its comma added, or
     * before its closing bracket when it is empty
     * @param container
     * @param texts the items (the entries of a dictionary: 'key': value), by their indentation
     */
    protected append(container: GypList | GypDict, texts: ((indent: string) => string)[]): void {
        const items: GypBase[] = container.kind === 'list' ? container.items : container.entries.map((entry: GypEntry): GypBase => ({start: entry.key.start, end: entry.value.end}))
        const last: GypBase | undefined = items.at(-1)
        const multiline: boolean = this.text.slice(container.start, container.close).includes('\n')
        if (!last) {
            if (!multiline) {
                this.edits.push({offset: container.close, remove: 0, insert: texts.map((text): string => text('')).join(', ')})
                return
            }
            //Before the closing bracket, on lines of their own, after the comments of the empty container
            const indent: string = LineIndent(this.text, container.close) + this.indent
            const lineStart: number = this.text.lastIndexOf('\n', container.close - 1) + 1
            const lines: string = texts.map((text): string => `${indent}${text(indent)}`).join(',\n')
            this.edits.push(/^[ \t]*$/.test(this.text.slice(lineStart, container.close))
                ? {offset: lineStart, remove: 0, insert: `${lines}\n`}
                : {offset: container.close, remove: 0, insert: `\n${lines}\n${LineIndent(this.text, container.close)}`})
            return
        }
        //After the last item and its comma
        const comma: number = this.text.indexOf(',', last.end)
        const hasComma: boolean = container.trailingComma && comma >= 0 && comma < container.close
        const after: number = hasComma ? comma + 1 : last.end
        if (!multiline) {
            this.edits.push({offset: after, remove: 0, insert: `${hasComma ? '' : ','} ${texts.map((text): string => text('')).join(', ')}${hasComma ? ',' : ''}`})
            return
        }
        const indent: string = LineIndent(this.text, last.start)
        const lines: string = texts.map((text): string => `${indent}${text(indent)}`).join(',\n')
        //After the line of the last item, its comment kept on it (its comma added after the item)
        const lineEnd: number = LineEnd(this.text, after)
        if (lineEnd < container.close && /^[ \t]*(#.*)?$/.test(this.text.slice(after, lineEnd))) {
            if (!hasComma) this.edits.push({offset: last.end, remove: 0, insert: ','})
            this.edits.push({offset: lineEnd, remove: 0, insert: `\n${lines}${hasComma ? ',' : ''}`})
            return
        }
        this.edits.push({offset: after, remove: 0, insert: `${hasComma ? '' : ','}\n${lines}${hasComma ? ',' : ''}`})
    }

    /**
     * The document with its changes (parsed again)
     */
    public applied(): GypDocument {
        return new GypDocument(this.file, ApplyEdits(this.text, this.edits))
    }

    /**
     * Add values to the list of a key of a dictionary (created when missing), the values it has skipped
     * @param dict
     * @param key
     * @param values
     * @return whether the file is changed
     */
    public addToList(dict: GypDict, key: string, values: string[]): boolean {
        const existing: GypNode | undefined = GypDocument.get(dict, key)
        if (existing && existing.kind !== 'list') throw new NativeSyntaxError(this.file, this.text, existing.start, `"${key}" is not a list`)
        const present: Set<string> = new Set(existing ? existing.items.filter((item: GypNode): item is GypString => item.kind === 'string').map((item: GypString): string => item.value) : [])
        const missing: string[] = values.filter((value: string): boolean => !present.has(value))
        if (!missing.length) return false
        if (existing) {
            this.append(existing, missing.map((value: string): () => string => (): string => this.literal(value)))
        } else {
            this.append(dict, [(indent: string): string => `${this.literal(key)}: ${this.render(missing, indent)}`])
        }
        return true
    }

    /**
     * Add an entry to a dictionary (when its key is missing)
     * @param dict
     * @param key
     * @param value
     * @return whether the file is changed
     */
    public addEntry(dict: GypDict, key: string, value: unknown): boolean {
        if (GypDocument.get(dict, key)) return false
        this.append(dict, [(indent: string): string => `${this.literal(key)}: ${this.render(value, indent)}`])
        return true
    }

    /**
     * Add an item to a list
     * @param list
     * @param value
     */
    public addItem(list: GypList, value: unknown): void {
        this.append(list, [(indent: string): string => this.render(value, indent)])
    }
}

/**
 * The normalized text of a condition of gyp (OS=="mac" and OS == 'mac' are the same condition)
 * @param condition
 */
export function NormalizeCondition(condition: string): string {
    return condition.replace(/\s+/g, '').replace(/'/g, '"')
}

/**
 * The target of a gyp file, and the file it is declared in: the targets of the file, or of the files it includes
 * (the includes of its root, relative to it)
 * @param file
 * @param name the name of the target, the only one by default
 */
export async function FindGypTarget(file: string, name?: string): Promise<{ document: GypDocument, target: GypDict }> {
    const found: { document: GypDocument, target: GypDict }[] = []
    const visited: Set<string> = new Set()
    const visit = async (current: string): Promise<void> => {
        if (visited.has(current)) return
        visited.add(current)
        const document: GypDocument = await GypDocument.read(current)
        const targets: GypNode | undefined = GypDocument.get(document.root, 'targets')
        if (targets?.kind === 'list') {
            for (const target of targets.items) if (target.kind === 'dict') found.push({document: document, target: target})
        }
        const includes: GypNode | undefined = GypDocument.get(document.root, 'includes')
        if (includes?.kind === 'list') {
            for (const include of includes.items) if (include.kind === 'string') await visit(path.resolve(path.dirname(current), include.value))
        }
    }
    await visit(file)
    const named = (entry: { target: GypDict }): string | undefined => {
        const value: GypNode | undefined = GypDocument.get(entry.target, 'target_name')
        return value?.kind === 'string' ? value.value : undefined
    }
    if (!found.length) throw new Error(`${file} declares no target (in its targets, or in the files it includes)`)
    if (name !== undefined) {
        const target = found.find((entry): boolean => named(entry) === name)
        if (!target) throw new Error(`${file} has no target ${name} (${found.map(named).join(', ')})`)
        return target
    }
    if (found.length > 1) throw new Error(`${file} has several targets (${found.map(named).join(', ')}): --target gives the one changed`)
    return found[0]
}
