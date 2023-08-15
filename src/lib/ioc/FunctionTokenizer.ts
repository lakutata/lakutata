import 'reflect-metadata'

/**
 * 标记类型
 */
export type TokenType =
    | 'ident'
    | '('
    | ')'
    | ','
    | '='
    | '*'
    | 'function'
    | 'class'
    | 'EOF'

/**
 * 词法分析器标记
 */
export interface Token {
    type: TokenType
    value?: string
}

/**
 * 可以传递给标记器的标志，用于切换某些功能
 */
export const enum TokenizerFlags {
    None = 0,
    /**
     * 如果设置了此选项，标记器将不会尝试智能跳过表达式
     */
    Dumb = 1,
}

/**
 * 为指定的源代码创建一个标记器
 * @param source
 */
export function createTokenizer(source: string) {
    const end = source.length
    let pos: number = 0
    let type: TokenType = 'EOF'
    let value: string = ''
    let flags = TokenizerFlags.None
    // These are used to greedily skip as much as possible.
    // Whenever we reach a paren, we increment these.
    let parenLeft = 0
    let parenRight = 0
    return {
        next,
        done
    }

    /**
     * 推进标记器并返回下一个标记
     */
    function next(nextFlags: TokenizerFlags = TokenizerFlags.None): Token {
        flags = nextFlags
        advance()
        return createToken()
    }

    /**
     * Advances the tokenizer state.
     */
    function advance() {
        value = ''
        type = 'EOF'
        while (true) {
            if (pos >= end) return (type = 'EOF')
            let ch: string = source.charAt(pos)
            // Whitespace is irrelevant
            if (isWhiteSpace(ch)) {
                pos++
                continue
            }
            switch (ch) {
                case '(':
                    pos++
                    parenLeft++
                    return (type = ch)
                case ')':
                    pos++
                    parenRight++
                    return (type = ch)
                case '*':
                    pos++
                    return (type = ch)
                case ',':
                    pos++
                    return (type = ch)
                case '=':
                    pos++
                    if ((flags & TokenizerFlags.Dumb) === 0) {
                        // Not in dumb-mode, so attempt to skip.
                        skipExpression()
                    }
                    // We need to know that there's a default value so we can
                    // skip it if it does not exist when resolving.
                    return (type = ch)
                case '/':
                    pos++
                    const nextCh: string = source.charAt(pos)
                    if (nextCh === '/') {
                        skipUntil((c: string): boolean => c === '\n', true)
                        pos++
                    }
                    if (nextCh === '*') {
                        skipUntil((c: string) => {
                            const closing: string = source.charAt(pos + 1)
                            return c === '*' && closing === '/'
                        }, true)
                        pos++
                    }
                    continue
                default:
                    // Scans an identifier.
                    if (isIdentifierStart(ch)) {
                        scanIdentifier()
                        return type
                    }
                    // Elegantly skip over tokens we don't care about.
                    pos++
            }
        }
    }

    /**
     * 扫描标识符，假设已经准备好这样做
     */
    function scanIdentifier(): string {
        const identStart: string = source.charAt(pos)
        const start: number = ++pos
        while (isIdentifierPart(source.charAt(pos))) pos++
        value = '' + identStart + source.substring(start, pos)
        type = value === 'function' || value === 'class' ? value : 'ident'
        if (type !== 'ident') value = ''
        return value
    }

    /**
     * 跳过直到下一个逗号或参数列表结束的所有内容。检查括号平衡，以便正确跳过函数调用
     */
    function skipExpression(): void {
        skipUntil((ch: string): boolean => {
            const isAtRoot: boolean = parenLeft === parenRight + 1
            if (ch === ',' && isAtRoot) return true
            if (ch === '(') {
                parenLeft++
                return false
            }
            if (ch === ')') {
                parenRight++
                if (isAtRoot) {
                    return true
                }
            }
            return false
        })
    }

    /**
     * 跳过字符串和空格，直到谓词为真
     * @param callback 当此函数返回true时停止跳过
     * @param dumb 如果为true，则不跳过空格和字符串；它只会在回调函数返回true时停止
     */
    function skipUntil(callback: (ch: string) => boolean, dumb: boolean = false): void {
        while (pos < source.length) {
            let ch: string = source.charAt(pos)
            if (callback(ch)) return
            if (!dumb) {
                if (isWhiteSpace(ch)) {
                    pos++
                    continue
                }
                if (isStringQuote(ch)) {
                    skipString()
                    continue
                }
            }
            pos++
        }
    }

    /**
     * 假设当前位置在字符串引号处，跳过整个字符串
     */
    function skipString(): void {
        const quote = source.charAt(pos)
        pos++
        while (pos < source.length) {
            const ch: string = source.charAt(pos)
            const prev: string = source.charAt(pos - 1)
            // Checks if the quote was escaped.
            if (ch === quote && prev !== '\\') {
                pos++
                return
            }
            // Template strings are a bit tougher, we want to skip the interpolated values.
            if (quote === '`') {
                const next: string = source.charAt(pos + 1)
                if (next === '$') {
                    const afterDollar: string = source.charAt(pos + 2)
                    if (afterDollar === '{') {
                        // This is the start of an interpolation; skip the ${
                        pos = pos + 2
                        // Skip strings and whitespace until we reach the ending }.
                        // This includes skipping nested interpolated strings. :D
                        skipUntil((ch) => ch === '}')
                    }
                }
            }
            pos++
        }
    }

    /**
     * 根据当前状态创建一个标记
     */
    function createToken(): Token {
        if (value) return {value, type}
        return {type}
    }

    /**
     * 确定是否完成解析
     */
    function done(): boolean {
        return type === 'EOF'
    }
}

/**
 * 确定给定的字符是否为空格字符
 * @param ch
 */
function isWhiteSpace(ch: string): boolean {
    switch (ch) {
        case '\r':
        case '\n':
        case ' ':
            return true
    }
    return false
}

/**
 * 确定指定的字符是否为字符串引号
 * @param ch
 */
function isStringQuote(ch: string): boolean {
    switch (ch) {
        case '\'':
        case '"':
        case '`':
            return true
    }
    return false
}

const IDENT_START_EXPR: RegExp = /^[_$a-zA-Z\xA0-\uFFFF]$/
const IDENT_PART_EXPR: RegExp = /^[._$a-zA-Z0-9\xA0-\uFFFF]$/

/**
 * 确定字符是否为有效的 JavaScript 标识符起始字符
 */
function isIdentifierStart(ch: string): boolean {
    return IDENT_START_EXPR.test(ch)
}

/**
 * 确定字符是否为有效的 JavaScript 标识符起始字符
 */
function isIdentifierPart(ch: string) {
    return IDENT_PART_EXPR.test(ch)
}
