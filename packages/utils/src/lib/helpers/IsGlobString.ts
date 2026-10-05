/**
 * Derived from index.js of is-glob 4.0.3 and of is-extglob 2.1.1 (MIT, see THIRD_PARTY_NOTICES.md): the strict check of
 * 2.x, with the ? wildcard of Glob anywhere
 */

const CHARS: Record<string, string> = {'{': '}', '(': ')', '[': ']'}

/**
 * Whether a string has an extglob (@(a), ?(a), !(a), +(a), *(a)) not escaped
 * @param str
 */
function IsExtglob(str: string): boolean {
    if (typeof str !== 'string' || str === '') return false
    let match: RegExpExecArray | null
    while ((match = /(\\).|([@?!+*]\(.*\))/g.exec(str))) {
        if (match[2]) return true
        str = str.slice(match.index + match[0].length)
    }
    return false
}

/**
 * Whether a string has glob characters not escaped (the brackets, braces and parentheses closed)
 * @param str
 */
function StrictCheck(str: string): boolean {
    if (str[0] === '!') return true
    let index: number = 0
    let pipeIndex: number = -2
    let closeSquareIndex: number = -2
    let closeCurlyIndex: number = -2
    let closeParenIndex: number = -2
    let backSlashIndex: number = -2
    while (index < str.length) {
        if (str[index] === '*') return true
        if (str[index + 1] === '?' && /[\].+)]/.test(str[index])) return true
        if (closeSquareIndex !== -1 && str[index] === '[' && str[index + 1] !== ']') {
            if (closeSquareIndex < index) closeSquareIndex = str.indexOf(']', index)
            if (closeSquareIndex > index) {
                if (backSlashIndex === -1 || backSlashIndex > closeSquareIndex) return true
                backSlashIndex = str.indexOf('\\', index)
                if (backSlashIndex === -1 || backSlashIndex > closeSquareIndex) return true
            }
        }
        if (closeCurlyIndex !== -1 && str[index] === '{' && str[index + 1] !== '}') {
            closeCurlyIndex = str.indexOf('}', index)
            if (closeCurlyIndex > index) {
                backSlashIndex = str.indexOf('\\', index)
                if (backSlashIndex === -1 || backSlashIndex > closeCurlyIndex) return true
            }
        }
        if (closeParenIndex !== -1 && str[index] === '(' && str[index + 1] === '?' && /[:!=]/.test(str[index + 2]) && str[index + 3] !== ')') {
            closeParenIndex = str.indexOf(')', index)
            if (closeParenIndex > index) {
                backSlashIndex = str.indexOf('\\', index)
                if (backSlashIndex === -1 || backSlashIndex > closeParenIndex) return true
            }
        }
        if (pipeIndex !== -1 && str[index] === '(' && str[index + 1] !== '|') {
            if (pipeIndex < index) pipeIndex = str.indexOf('|', index)
            if (pipeIndex !== -1 && str[pipeIndex + 1] !== ')') {
                closeParenIndex = str.indexOf(')', pipeIndex)
                if (closeParenIndex > pipeIndex) {
                    backSlashIndex = str.indexOf('\\', pipeIndex)
                    if (backSlashIndex === -1 || backSlashIndex > closeParenIndex) return true
                }
            }
        }
        if (str[index] === '\\') {
            //An escaped character, its group skipped
            const open: string = str[index + 1]
            index += 2
            const close: string | undefined = CHARS[open]
            if (close) {
                const n: number = str.indexOf(close, index)
                if (n !== -1) index = n + 1
            }
            if (str[index] === '!') return true
        } else {
            index++
        }
    }
    return false
}

/**
 * Tell whether a string is a glob pattern rather than a literal path: whether it has an unescaped `*`, a closed
 * bracket class (`[abc]`), a closed brace group (`{a,b}`), an extglob (`@(a|b)`, `!(a)`…), a regex-like group
 * (`(a|b)`), a leading `!` (a negation), or an unescaped `?` (a wildcard of one character for {@link Glob}: `'a?b'`).
 * A character escaped with `\` does not count.
 * @param inp The string to test; an empty string or a value which is not a string gives `false`.
 * @returns `true` when the string has glob syntax, `false` otherwise.
 * @example
 * ```typescript
 * import {isGlobString} from 'lakutata/utils'
 *
 * console.log(isGlobString('src/**\/*.ts'), isGlobString('src/{a,b}.ts'))
 * //true true
 * console.log(isGlobString('src/index.ts'), isGlobString('\\*.ts'), isGlobString('a?b'))
 * //false false true
 * ```
 */
export function isGlobString(inp: string): boolean {
    if (typeof inp !== 'string' || inp === '') return false
    if (IsExtglob(inp)) return true
    //The ? wildcard of Glob, wherever it is (the strict check only sees it after ], ., + or ))
    if (inp.replace(/\\./g, '').includes('?')) return true
    return StrictCheck(inp)
}
