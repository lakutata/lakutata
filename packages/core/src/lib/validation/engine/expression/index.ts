/**
 * Derived from the upstream lib/index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * Value of a expression constant
 */
export type ExpressionConstant = string | number | boolean | null

/**
 * Function evaluating a expression part against a context
 */
export type ExpressionEvaluator = (context: unknown) => unknown

/**
 * Function callable from a expression, `this` is the evaluation context
 */
export type ExpressionFunction = (this: unknown, ...args: unknown[]) => unknown

export interface ParserOptions {
    /**
     * Constants the expression may reference by name
     */
    readonly constants?: Record<string, ExpressionConstant>
    /**
     * Regular expression every reference must match
     */
    readonly tokenRx?: RegExp
    /**
     * Resolver of references, defaults to reading the reference from the context
     */
    readonly reference?: (name: string) => ExpressionEvaluator
    /**
     * Functions the expression may call by name
     */
    readonly functions?: Record<string, ExpressionFunction>
}

const settingsSymbol: unique symbol = Symbol('settings')
const expressionSymbol: unique symbol = Symbol('expression')

interface ParserSettings extends ParserOptions {
    readonly [settingsSymbol]: true
    readonly constants: Record<string, ExpressionConstant>
    readonly functions: Record<string, ExpressionFunction>
}

const operators: string[] = ['!', '^', '*', '/', '%', '+', '-', '<', '<=', '>', '>=', '==', '!=', '&&', '||', '??']
const operatorCharacters: string[] = ['!', '^', '*', '/', '%', '+', '-', '<', '=', '>', '&', '|', '?']
const operatorsOrder: string[][] = [['^'], ['*', '/', '%'], ['+', '-'], ['<', '<=', '>', '>='], ['==', '!='], ['&&'], ['||', '??']]
const operatorsPrefix: string[] = ['!', 'n']
const literals: Record<string, string> = {
    '"': '"',
    '`': '`',
    '\'': '\'',
    '[': ']'
}
const numberRx: RegExp = /^(?:[0-9]*(\.[0-9]*)?){1}$/
const tokenRx: RegExp = /^[\w\$\#\.\@\:\{\}]+$/

type ParsedPart =
    | { type: 'segment', value: Parser }
    | { type: 'literal', value: string }
    | { type: 'operator', value: string }
    | { type: 'constant', value: ExpressionConstant }
    | { type: 'reference', value: string }
    | { type: 'function', value: ExpressionEvaluator }

/**
 * A prefix operator ('!' or 'n', the internal negative operator), kept as a part until evaluation
 */
interface PrefixOperator {
    type: 'operator'
    value: string
}

/**
 * A processed part: an infix operator (string), a prefix operator, or an operand
 */
type ProcessedPart = string | PrefixOperator | ExpressionConstant | Parser | ExpressionEvaluator

/**
 * A expression parsed into parts, evaluated against a context
 */
export class Parser<T = unknown> {

    public settings: ParserSettings

    public single: { type: 'reference' | 'value', value: unknown } | null = null

    protected _parts: ProcessedPart[] | null = null

    constructor(string: string, options: ParserOptions | ParserSettings = {}) {
        if (!(options as Partial<ParserSettings>)[settingsSymbol] && options.constants) {
            for (const constant in options.constants) {
                const value: unknown = options.constants[constant]
                if (value !== null && !['boolean', 'number', 'string'].includes(typeof value)) {
                    throw new Error(`Expression constant ${constant} contains invalid ${typeof value} value type`)
                }
            }
        }
        this.settings = (options as Partial<ParserSettings>)[settingsSymbol] ? options as ParserSettings : {[settingsSymbol]: true, constants: {}, functions: {}, ...options} as ParserSettings
        this._parse(string)
    }

    protected _parse(string: string): void {
        let parts: ParsedPart[] = []
        let current: string = ''
        let parenthesis: number = 0
        let literal: string | false = false
        const flush = (inner?: string): void => {
            if (parenthesis) throw new Error('Expression missing closing parenthesis')
            const last: ParsedPart | null = parts.length ? parts[parts.length - 1] : null
            if (!literal && !current && !inner) return
            //Function
            if (last && last.type === 'reference' && inner === ')') {
                parts[parts.length - 1] = {type: 'function', value: this._subExpression(current, last.value)}
                current = ''
                return
            }
            if (inner === ')') {
                //Segment
                const sub: Parser = new Parser(current, this.settings)
                parts.push({type: 'segment', value: sub})
            } else if (literal) {
                //Reference
                if (literal === ']') {
                    parts.push({type: 'reference', value: current})
                    current = ''
                    return
                }
                //Literal
                parts.push({type: 'literal', value: current})
            } else if (operatorCharacters.includes(current)) {
                //Operator, 2 characters operator
                if (last && last.type === 'operator' && operators.includes(last.value + current)) {
                    last.value += current
                } else {
                    parts.push({type: 'operator', value: current})
                }
            } else if (current.match(numberRx)) {
                //Number
                parts.push({type: 'constant', value: parseFloat(current)})
            } else if (this.settings.constants[current] !== undefined) {
                //Constant
                parts.push({type: 'constant', value: this.settings.constants[current]})
            } else {
                //Reference
                if (!current.match(tokenRx)) throw new Error(`Expression contains invalid token: ${current}`)
                parts.push({type: 'reference', value: current})
            }
            current = ''
        }
        for (const c of string) {
            if (literal) {
                if (c === literal) {
                    flush()
                    literal = false
                } else {
                    current += c
                }
            } else if (parenthesis) {
                if (c === '(') {
                    current += c
                    ++parenthesis
                } else if (c === ')') {
                    --parenthesis
                    if (!parenthesis) {
                        flush(c)
                    } else {
                        current += c
                    }
                } else {
                    current += c
                }
            } else if (c in literals) {
                literal = literals[c]
            } else if (c === '(') {
                flush()
                ++parenthesis
            } else if (operatorCharacters.includes(c)) {
                flush()
                current = c
                flush()
            } else if (c !== ' ') {
                current += c
            } else {
                flush()
            }
        }
        flush()
        //Replace prefix - to internal negative operator
        parts = parts.map((part: ParsedPart, i: number): ParsedPart => {
            if (part.type !== 'operator' || part.value !== '-' || i && parts[i - 1].type !== 'operator') return part
            return {type: 'operator', value: 'n'}
        })
        //Validate tokens order
        let operator: boolean = false
        for (const part of parts) {
            if (part.type === 'operator') {
                if (operatorsPrefix.includes(part.value)) continue
                if (!operator) throw new Error('Expression contains an operator in invalid position')
                if (!operators.includes(part.value)) throw new Error(`Expression contains an unknown operator ${part.value}`)
            } else if (operator) {
                throw new Error('Expression missing expected operator')
            }
            operator = !operator
        }
        if (!operator) throw new Error('Expression contains invalid trailing operator')
        //Identify single part
        if (parts.length === 1 && ['reference', 'literal', 'constant'].includes(parts[0].type)) {
            this.single = {type: parts[0].type === 'reference' ? 'reference' : 'value', value: parts[0].value}
        }
        //Process parts
        this._parts = parts.map((part: ParsedPart): ProcessedPart => {
            //Operators
            if (part.type === 'operator') return operatorsPrefix.includes(part.value) ? part : part.value
            //Literals, constants, segments
            if (part.type !== 'reference') return part.value
            //References
            if (this.settings.tokenRx && !this.settings.tokenRx.test(part.value)) throw new Error(`Expression contains invalid reference ${part.value}`)
            if (this.settings.reference) return this.settings.reference(part.value)
            return reference(part.value)
        })
    }

    protected _subExpression(string: string, name: string): ExpressionEvaluator {
        const method: ExpressionFunction | undefined = this.settings.functions[name]
        if (typeof method !== 'function') throw new Error(`Expression contains unknown function ${name}`)
        const rawArgs: string[] = []
        if (string) {
            let current: string = ''
            let parenthesis: number = 0
            let literal: string | false = false
            const flush = (): void => {
                if (!current) throw new Error(`Expression contains function ${name} with invalid arguments ${string}`)
                rawArgs.push(current)
                current = ''
            }
            for (let i: number = 0; i < string.length; ++i) {
                const c: string = string[i]
                if (literal) {
                    current += c
                    if (c === literal) literal = false
                } else if (c in literals && !parenthesis) {
                    current += c
                    literal = literals[c]
                } else if (c === ',' && !parenthesis) {
                    flush()
                } else {
                    current += c
                    if (c === '(') {
                        ++parenthesis
                    } else if (c === ')') {
                        --parenthesis
                    }
                }
            }
            flush()
        }
        const args: Parser[] = rawArgs.map((arg: string): Parser => new Parser(arg, this.settings))
        return function (context: unknown): unknown {
            const innerValues: unknown[] = []
            for (const arg of args) innerValues.push(arg.evaluate(context))
            return method.call(context, ...innerValues)
        }
    }

    /**
     * Evaluate the expression against a context
     * @param context
     */
    public evaluate(context?: unknown): T {
        const parts: unknown[] = (this._parts as ProcessedPart[]).slice()
        //Prefix operators
        for (let i: number = parts.length - 2; i >= 0; --i) {
            const part: unknown = parts[i]
            if (isPrefixOperator(part)) {
                const current: unknown = parts[i + 1]
                parts.splice(i + 1, 1)
                const value: unknown = evaluatePart(current, context)
                parts[i] = single(part.value, value)
            }
        }
        //Left-right operators
        operatorsOrder.forEach((set: string[]): void => {
            for (let i: number = 1; i < parts.length - 1;) {
                if (set.includes(parts[i] as string)) {
                    const operator: string = parts[i] as string
                    const left: unknown = evaluatePart(parts[i - 1], context)
                    const right: unknown = evaluatePart(parts[i + 1], context)
                    parts.splice(i, 2)
                    const result: unknown = calculate(operator, left, right)
                    //Convert -0
                    parts[i - 1] = result === 0 ? 0 : result
                } else {
                    i += 2
                }
            }
        })
        return evaluatePart(parts[0], context) as T
    }
}

Object.defineProperty(Parser.prototype, expressionSymbol, {value: true, writable: true, enumerable: true, configurable: true})

function isPrefixOperator(part: unknown): part is PrefixOperator {
    return !!part && (part as Partial<PrefixOperator>).type === 'operator'
}

function reference(name: string): ExpressionEvaluator {
    return function (context: unknown): unknown {
        return context && (context as Record<string, unknown>)[name] !== undefined ? (context as Record<string, unknown>)[name] : null
    }
}

function evaluatePart(part: unknown, context: unknown): unknown {
    if (part === null) return null
    if (typeof part === 'function') return (part as ExpressionEvaluator)(context)
    if ((part as { [expressionSymbol]?: boolean })[expressionSymbol]) return (part as Parser).evaluate(context)
    return part
}

function single(operator: string, value: unknown): unknown {
    if (operator === '!') return value ? false : true
    //operator === 'n'
    const negative: number = -(value as number)
    //Override -0
    if (negative === 0) return 0
    return negative
}

function exists(value: unknown): boolean {
    return value !== null && value !== undefined
}

/**
 * Apply an infix operator, with JavaScript's operand coercion
 * @param operator
 * @param left
 * @param right
 */
function calculate(operator: string, left: unknown, right: unknown): unknown {
    if (operator === '??') return exists(left) ? left : right
    //Operands are coerced by JavaScript at runtime, the number casts only satisfy the type checker
    const l: number = left as number
    const r: number = right as number
    if (typeof left === 'string' || typeof right === 'string') {
        if (operator === '+') return ((exists(left) ? left : '') as string) + ((exists(right) ? right : '') as string)
    } else {
        switch (operator) {
            case '^':
                return Math.pow(l, r)
            case '*':
                return l * r
            case '/':
                return l / r
            case '%':
                return l % r
            case '+':
                return l + r
            case '-':
                return l - r
        }
    }
    switch (operator) {
        case '<':
            return l < r
        case '<=':
            return l <= r
        case '>':
            return l > r
        case '>=':
            return l >= r
        case '==':
            return left === right
        case '!=':
            return left !== right
        case '&&':
            return left && right
        case '||':
            return left || right
    }
    return null
}
