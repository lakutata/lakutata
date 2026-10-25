import type {Token} from '../declarations/Lexer.js'

/**
 * The words that change nothing of what a declaration declares, removed from the declarations written
 */
const NOISE: ReadonlySet<string> = new Set([
    '__extension__', '__restrict', '__restrict__', 'restrict', '_Nullable', '_Nonnull', '_Null_unspecified', '__nullable', '__nonnull',
    '__null_unspecified', '_Nullable_result', '__ptr32', '__ptr64', '__unaligned', '__w64'
])

/**
 * The end of the balanced brackets opened at an index: the index of the closing one
 * @param tokens
 * @param open
 */
function closing(tokens: readonly Token[], open: number): number {
    let depth: number = 0
    for (let index: number = open; index < tokens.length; index++) {
        const token: Token = tokens[index]
        if (token.kind !== 'punctuator') continue
        if (token.text === '(' || token.text === '[' || token.text === '{') depth++
        else if ((token.text === ')' || token.text === ']' || token.text === '}') && --depth === 0) return index
    }
    return tokens.length - 1
}

/**
 * The tokens of a declaration without what changes nothing of what it declares: the attributes but packed and aligned,
 * the __declspec but align, the qualifiers the parser ignores
 * @param tokens
 */
export function prunedTokens(tokens: readonly Token[]): Token[] {
    const kept: Token[] = []
    for (let index: number = 0; index < tokens.length; index++) {
        const token: Token = tokens[index]
        if (token.kind === 'identifier' && NOISE.has(token.text)) continue
        const attribute: boolean = token.kind === 'identifier' && (token.text === '__attribute__' || token.text === '__attribute' || token.text === '__declspec')
        if (attribute && tokens[index + 1]?.text === '(') {
            const end: number = closing(tokens, index + 1)
            const inner: string[] = tokens.slice(index + 2, end).map((part: Token): string => part.text.replace(/^__|__$/g, ''))
            const meaningful: boolean = token.text === '__declspec' ? inner.includes('align') : inner.includes('packed') || inner.includes('aligned')
            if (meaningful) kept.push(...tokens.slice(index, end + 1))
            index = end
            continue
        }
        kept.push(token)
    }
    return kept
}

/**
 * The text of a token as C writes it
 * @param token
 */
function textOf(token: Token): string {
    if (token.kind === 'string') return token.source ?? JSON.stringify(token.text)
    if (token.kind === 'pragma') return `#pragma ${token.text}`
    return token.text
}

/**
 * A declaration written as C, one member of a struct or a value of an enum by line
 * @param tokens Its tokens.
 * @param indent The indentation of a level.
 * @returns Its lines.
 */
export function declarationText(tokens: readonly Token[], indent: string = '    '): string[] {
    const lines: string[] = []
    let line: string = ''
    //The braces open: whether each one is the body of an enum
    const braces: boolean[] = []
    let parens: number = 0
    const breakLine = (): void => {
        if (line.trim()) lines.push(line.replace(/\s+$/, ''))
        line = indent.repeat(braces.length)
    }
    let previous: Token | undefined
    for (let index: number = 0; index < tokens.length; index++) {
        const token: Token = tokens[index]
        const text: string = textOf(token)
        if (token.kind === 'pragma') {
            breakLine()
            line += text
            breakLine()
            previous = undefined
            continue
        }
        const punctuator: string | undefined = token.kind === 'punctuator' ? token.text : undefined
        if (punctuator === '{') {
            const enumBody: boolean = tokens.slice(Math.max(0, index - 2), index).some((part: Token): boolean => part.kind === 'identifier' && part.text === 'enum')
            line += `${line.trim() ? ' ' : ''}{`
            braces.push(enumBody)
            breakLine()
            previous = token
            continue
        }
        if (punctuator === '}') {
            braces.pop()
            breakLine()
            line += '}'
            previous = token
            continue
        }
        if (punctuator === '(' || punctuator === '[') parens++
        if (punctuator === ')' || punctuator === ']') parens--
        const glued: boolean = !previous
            || [',', ';', ')', ']', '['].includes(punctuator ?? '')
            || (previous.kind === 'punctuator' && ['(', '[', '*', '~', '!'].includes(previous.text))
            || (punctuator === '(' && (previous.kind === 'identifier' || previous.text === ')') && tokens[index + 1]?.text !== '*')
            || !line.trim()
        line += `${glued ? '' : ' '}${text}`
        previous = token
        //A member of a struct, a value of an enum: one by line
        if (braces.length && !parens && (punctuator === ';' || (punctuator === ',' && braces[braces.length - 1]))) {
            breakLine()
            previous = undefined
        }
    }
    breakLine()
    return lines
}
