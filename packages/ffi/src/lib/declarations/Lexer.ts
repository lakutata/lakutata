import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'

export type TokenKind = 'identifier' | 'number' | 'char' | 'string' | 'punctuator' | 'pragma' | 'define' | 'undef' | 'end'

export interface Token {
    readonly kind: TokenKind
    readonly text: string
    /**
     * The value of an integer or of a character
     */
    readonly value?: bigint
    /**
     * Whether a number is a floating-point one
     */
    readonly float?: boolean
    readonly line: number
    readonly column: number
}

const PUNCTUATORS: readonly string[] = ['...', '<<=', '>>=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '->', '++', '--', '##', '::']
const SINGLE: string = '{}()[];,*:=+-/%&|^~!?<>.#'

const ESCAPES: Record<string, number> = {n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11, '\\': 92, '\'': 39, '"': 34, '?': 63, e: 27}

/**
 * The directives of the preprocessor that change what is declared: the declarations given must be preprocessed
 */
const CONDITIONALS: readonly string[] = ['if', 'ifdef', 'ifndef', 'elif', 'elifdef', 'elifndef', 'else', 'endif']

/**
 * The offsets the lines of a text start at
 * @param text
 */
function lineStartsOf(text: string): number[] {
    const starts: number[] = [0]
    for (let i: number = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
    return starts
}

/**
 * Where an offset of a text is, for the messages: its line and its column (from 1)
 * @param starts the offsets the lines start at
 * @param offset
 */
function positionOf(starts: number[], offset: number): { line: number, column: number } {
    let low: number = 0
    let high: number = starts.length - 1
    while (low < high) {
        const middle: number = (low + high + 1) >> 1
        if (starts[middle] <= offset) low = middle
        else high = middle - 1
    }
    return {line: low + 1, column: offset - starts[low] + 1}
}

/**
 * The exception of a declaration that cannot be read, at a line and a column
 * @param message
 * @param line
 * @param column
 */
export function declarationError(message: string, line: number, column: number): NativeDeclarationException {
    return new NativeDeclarationException(`${message} (line ${line}, column ${column})`)
}

/**
 * The tokens of C declarations. Comments are skipped; of the directives of the preprocessor, #pragma pack, #define and
 * #undef are kept (as tokens holding the rest of their line), the line markers of a preprocessed file, #include and the
 * other #pragma are skipped, and the conditional ones (#if, #ifdef…) are refused: what they select is the work of a
 * preprocessor
 * @param text
 */
export function tokenize(text: string): Token[] {
    const tokens: Token[] = []
    const length: number = text.length
    let i: number = 0
    let lineStart: boolean = true
    const starts: number[] = lineStartsOf(text)
    const fail = (message: string, offset: number): never => {
        const {line, column} = positionOf(starts, offset)
        throw declarationError(message, line, column)
    }
    const push = (kind: TokenKind, start: number, end: number, extra: { value?: bigint, float?: boolean, text?: string } = {}): void => {
        const {line, column} = positionOf(starts, start)
        tokens.push({kind: kind, text: extra.text ?? text.slice(start, end), value: extra.value, float: extra.float, line: line, column: column})
    }
    while (i < length) {
        const char: string = text[i]
        //Whitespace, the continuations of lines
        if (char === '\n') {
            lineStart = true
            i++
            continue
        }
        if (char === ' ' || char === '\t' || char === '\r' || char === '\f' || char === '\v') {
            i++
            continue
        }
        if (char === '\\' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) {
            i += text[i + 1] === '\n' ? 2 : 3
            continue
        }
        //Comments
        if (char === '/' && text[i + 1] === '/') {
            while (i < length && text[i] !== '\n') i++
            continue
        }
        if (char === '/' && text[i + 1] === '*') {
            const end: number = text.indexOf('*/', i + 2)
            if (end < 0) fail('A comment is not closed', i)
            i = end + 2
            continue
        }
        //Directives of the preprocessor, at the start of a line
        if (char === '#' && lineStart) {
            const start: number = i
            let end: number = i
            while (end < length && text[end] !== '\n') end += text[end] === '\\' && text[end + 1] === '\n' ? 2 : 1
            const directive: string = text.slice(start + 1, end).replace(/\\\r?\n/g, ' ').trim()
            const name: string = directive.match(/^[A-Za-z_]\w*/)?.[0] ?? ''
            if (CONDITIONALS.includes(name)) fail(`The directive #${name} is not supported: run the header through the preprocessor first (cc -E, cl /P)`, start)
            const pack: RegExpMatchArray | null = directive.match(/^pragma\s+pack\s*\(([^)]*)\)/)
            if (pack) push('pragma', start, end, {text: `pack(${pack[1].replace(/\s+/g, '')})`})
            //The text of a macro after its name, its comments removed; the name directly followed by ( takes arguments
            if (name === 'define' || name === 'undef') push(name, start, end, {text: directive.slice(name.length).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '').trim()})
            i = end
            continue
        }
        lineStart = false
        //Identifiers, and the prefixes of the wide strings and characters
        if (/[A-Za-z_$]/.test(char)) {
            let end: number = i + 1
            while (end < length && /[\w$]/.test(text[end])) end++
            const word: string = text.slice(i, end)
            if ((text[end] === '\'' || text[end] === '"') && ['L', 'u', 'U', 'u8'].includes(word)) {
                i = end
                continue
            }
            push('identifier', i, end)
            i = end
            continue
        }
        //Numbers
        if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            let end: number = i
            const hex: boolean = /^0[xX]/.test(text.slice(i, i + 2))
            if (hex) end += 2
            while (end < length && (/[\w.]/.test(text[end]) || (/[eEpP]/.test(text[end - 1]) && /[+-]/.test(text[end]) && (!hex || /[pP]/.test(text[end - 1]))))) end++
            const literal: string = text.slice(i, end)
            const body: string = literal.replace(/(?:[uU](?:ll|LL|l|L)?|(?:ll|LL|l|L)[uU]?)$/, '')
            const float: boolean = hex ? /[.pP]/.test(body) : /[.eE]/.test(body) || /[fF]$/.test(literal)
            if (float) {
                push('number', i, end, {float: true})
            } else {
                let value: bigint
                try {
                    if (/^0[bB]/.test(body)) value = BigInt(body)
                    else if (/^0[0-7]+$/.test(body)) value = BigInt(`0o${body.slice(1)}`)
                    else value = BigInt(body)
                } catch {
                    return fail(`The number ${literal} is not valid`, i)
                }
                push('number', i, end, {value: value})
            }
            i = end
            continue
        }
        //Characters and strings
        if (char === '\'' || char === '"') {
            let end: number = i + 1
            const codes: number[] = []
            while (end < length && text[end] !== char) {
                if (text[end] === '\n') fail(char === '"' ? 'A string is not closed' : 'A character is not closed', i)
                if (text[end] === '\\') {
                    const next: string = text[end + 1]
                    if (next === 'x') {
                        const digits: string = text.slice(end + 2).match(/^[0-9a-fA-F]+/)?.[0] ?? ''
                        codes.push(parseInt(digits || '0', 16))
                        end += 2 + digits.length
                    } else if (/[0-7]/.test(next)) {
                        const digits: string = text.slice(end + 1).match(/^[0-7]{1,3}/)![0]
                        codes.push(parseInt(digits, 8))
                        end += 1 + digits.length
                    } else {
                        codes.push(ESCAPES[next] ?? next.charCodeAt(0))
                        end += 2
                    }
                } else {
                    codes.push(text.codePointAt(end)!)
                    end += text.codePointAt(end)! > 0xFFFF ? 2 : 1
                }
            }
            if (end >= length) fail(char === '"' ? 'A string is not closed' : 'A character is not closed', i)
            if (char === '\'') push('char', i, end + 1, {value: BigInt(codes[0] ?? 0)})
            else push('string', i, end + 1, {text: String.fromCodePoint(...codes)})
            i = end + 1
            continue
        }
        //Punctuators
        const punctuator: string | undefined = PUNCTUATORS.find((candidate: string): boolean => text.startsWith(candidate, i))
        if (punctuator) {
            push('punctuator', i, i + punctuator.length)
            i += punctuator.length
            continue
        }
        if (SINGLE.includes(char)) {
            push('punctuator', i, i + 1)
            i++
            continue
        }
        fail(`Unexpected character ${JSON.stringify(char)}`, i)
    }
    const {line, column} = positionOf(starts, length)
    tokens.push({kind: 'end', text: '', line: line, column: column})
    return tokens
}
