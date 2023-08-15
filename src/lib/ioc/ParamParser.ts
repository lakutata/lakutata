import 'reflect-metadata'
import {createTokenizer, Token, TokenizerFlags} from './FunctionTokenizer.js'

/**
 * 一个函数的参数
 */
export interface Parameter {
    /**
     * 参数名
     */
    name: string
    /**
     * 如果参数是可选的，则为true
     */
    optional: boolean
}

/**
 * 解析函数字符串的参数列表，包括ES6类的构造函数
 * @param source
 * 要从中提取参数列表的函数的源代码
 * @return {Array<Parameter> | null}
 * 返回参数数组，如果未找到类的构造函数，则返回null
 */
export function parseParameterList(source: string): Array<Parameter> | null {
    const {next: _next, done} = createTokenizer(source)
    const params: Array<Parameter> = []
    let t: Token = null!
    nextToken()
    while (!done()) {
        switch (t.type) {
            case 'class':
                skipUntilConstructor()
                // If we didn't find a constructor token, then we know that there
                // are no dependencies in the defined class.
                if (!isConstructorToken()) return null
                // Next token is the constructor identifier.
                nextToken()
                break
            case 'function':
                const next = nextToken()
                if (next.type === 'ident' || next.type === '*') nextToken() // This is the function name or a generator star. Skip it.
                break
            case '(':
                // Start parsing parameter names.
                parseParams()
                break
            case ')':
                // We're now out of the parameter list.
                return params
            case 'ident':
                // Likely a paren-less arrow function
                // which can have no default args.
                const param = {name: t.value!, optional: false}
                if (t.value === 'async') {
                    // Given it's the very first token, we can assume it's an async function,
                    // so skip the async keyword if the next token is not an equals sign, in which
                    // case it is a single-arg arrow func.
                    const next = nextToken()
                    if (next && next.type !== '=') {
                        break
                    }
                }
                params.push(param)
                return params
            default:
                throw unexpected()
        }
    }
    return params

    /**
     * 在被放置在函数的参数列表中后，解析参数
     */
    function parseParams(): void {
        // Current token is a left-paren
        let param: Parameter = {name: '', optional: false}
        while (!done()) {
            nextToken()
            switch (t.type) {
                case 'ident':
                    param.name = t.value!
                    break
                case '=':
                    param.optional = true
                    break
                case ',':
                    params.push(param)
                    param = {name: '', optional: false}
                    break
                case ')':
                    if (param.name) {
                        params.push(param)
                    }
                    return
                default:
                    throw unexpected()
            }
        }
    }

    /**
     * 跳过直到遇到构造函数标识符
     */
    function skipUntilConstructor(): void {
        while (!isConstructorToken() && !done()) nextToken(TokenizerFlags.Dumb)
    }

    /**
     * 确定当前令牌是否表示构造函数，并且它之后的下一个令牌是括号
     * @return {boolean}
     */
    function isConstructorToken(): boolean {
        return t.type === 'ident' && t.value === 'constructor'
    }

    /**
     * 前进到分词器，并将前一个令牌存储在历史记录中
     */
    function nextToken(flags: TokenizerFlags = TokenizerFlags.None) {
        t = _next(flags)
        return t
    }

    /**
     * 返回描述意外令牌的错误
     */
    function unexpected(): SyntaxError {
        return new SyntaxError(
            `Parsing parameter list, did not expect ${t.type} token${
                t.value ? ` (${t.value})` : ''
            }`
        )
    }
}
