/**
 * Derived from the upstream lib/index.js of the assertion library (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Test support only: the assertion library of the upstream test suites, running on node:test
 */
import {inspect} from 'node:util'
import {applyToDefaults, assert as utilsAssert, deepEqual, type DeepEqualOptions, isArray} from '../../../lib/validation/engine/utils/index.js'
import {contain} from './contain.js'

export const settings: { truncateMessages: boolean, comparePrototypes: boolean } = {
    truncateMessages: false,
    comparePrototypes: false
}

type ErrorType = abstract new (...args: never[]) => unknown

interface Flags {
    not?: boolean
    once?: boolean
    only?: boolean
    part?: boolean
    shallow?: boolean
    deep?: boolean
}

/**
 * Error thrown by a failed assertion
 */
export class AssertionFailure extends Error {
    public actual: unknown
    public expected: unknown
}

const natives: Record<string, string> = {
    '[object Arguments]': 'arguments',
    '[object Array]': 'array',
    '[object AsyncFunction]': 'function',
    '[object Date]': 'date',
    '[object Function]': 'function',
    '[object Number]': 'number',
    '[object RegExp]': 'regexp',
    '[object String]': 'string'
}

function typeOf(value: unknown): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (Buffer.isBuffer(value)) return 'buffer'
    const name: string = Object.prototype.toString.call(value)
    if (natives[name]) return natives[name]
    if (value === Object(value)) return 'object'
    return typeof value
}

function isPromise(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
}

function display(value: unknown): string {
    const string: string = value instanceof Error
        ? `[${value.toString()}]`
        : isPromise(value) ? '[Promise]' : typeof value === 'function' ? '[Function]' : inspect(value)
    if (!settings.truncateMessages || string.length <= 40) return string
    if (isArray(value)) return '[Array(' + value.length + ')]'
    if (typeof value === 'object' && value !== null) {
        const keys: string[] = Object.keys(value)
        return '{ Object (' + (keys.length > 2 ? (keys.splice(0, 2).join(', ') + ', ...') : keys.join(', ')) + ') }'
    }
    return string.slice(0, 40) + '...\''
}

function messageOf(error: unknown): string {
    return (error as { message?: string } | null | undefined)?.message ?? ''
}

function matchesMessage(error: string, message: string | RegExp): boolean {
    return typeof message === 'string' ? error === message : !!error.match(message)
}

/**
 * Split (type, message) assertion arguments
 * @param args
 */
function typeAndMessage(args: unknown[]): { type: ErrorType | null, message: string | RegExp | null } {
    const type: ErrorType | null = args.length && typeof args[0] !== 'string' && !(args[0] instanceof RegExp) ? args[0] as ErrorType : null
    const lastArg: unknown = args[1] ?? args[0]
    const message: string | RegExp | null = typeof lastArg === 'string' || lastArg instanceof RegExp ? lastArg : null
    return {type, message}
}

export class Assertion {

    #ref: unknown

    readonly #prefix: string

    #flags: Flags = {}

    constructor(ref: unknown, prefix?: string) {
        this.#ref = ref
        this.#prefix = prefix ?? ''
    }

    /**
     * Throw when the assertion is used incorrectly
     * @param condition
     * @param error
     */
    #usage(condition: unknown, error: string): void {
        if (!condition) utilsAssert(condition, error)
    }

    #assert(result: unknown, verb: string, ...details: unknown[]): this {
        if (this.#flags.not ? !result : result) {
            this.#flags = {}
            return this
        }
        if (verb === 'exist' && this.#flags.not && this.#ref instanceof Error) throw this.#ref
        let message: string = ''
        if (this.#prefix) message += this.#prefix + ': '
        message += 'Expected ' + display(this.#ref) + ' to '
        if (this.#flags.not) message += 'not '
        message += verb
        if (this.#flags.once) message += ' once'
        //'actual' without 'expected'
        if (details.length === 1) message += ' but got ' + display(details[0])
        const error: AssertionFailure = new AssertionFailure(message)
        error.actual = details[0]
        error.expected = details[1]
        throw error
    }

    #toggle(flag: keyof Flags): this {
        this.#flags[flag] = !this.#flags[flag]
        return this
    }

    //Flags
    public get not(): this {
        return this.#toggle('not')
    }

    public get once(): this {
        return this.#toggle('once')
    }

    public get only(): this {
        return this.#toggle('only')
    }

    public get part(): this {
        return this.#toggle('part')
    }

    public get shallow(): this {
        return this.#toggle('shallow')
    }

    //Grammar
    public get a(): this {
        return this
    }

    public get an(): this {
        return this
    }

    public get and(): this {
        return this
    }

    public get at(): this {
        return this
    }

    public get be(): this {
        return this
    }

    public get have(): this {
        return this
    }

    public get in(): this {
        return this
    }

    public get to(): this {
        return this
    }

    //Types
    #type(word: string): this {
        const article: string = ['a', 'e', 'i', 'o', 'u'].includes(word[0]) ? 'an ' : 'a '
        const type: string = typeOf(this.#ref)
        return this.#assert(type === word, 'be ' + article + word, type)
    }

    public arguments(): this {
        return this.#type('arguments')
    }

    public array(): this {
        return this.#type('array')
    }

    public boolean(): this {
        return this.#type('boolean')
    }

    public buffer(): this {
        return this.#type('buffer')
    }

    public date(): this {
        return this.#type('date')
    }

    public function(): this {
        return this.#type('function')
    }

    public number(): this {
        return this.#type('number')
    }

    public regexp(): this {
        return this.#type('regexp')
    }

    public string(): this {
        return this.#type('string')
    }

    public object(): this {
        return this.#type('object')
    }

    public error(...args: unknown[]): this {
        const type: ErrorType = args.length && typeof args[0] !== 'string' && !(args[0] instanceof RegExp) ? args[0] as ErrorType : Error
        const {message} = typeAndMessage(args)
        const err: unknown = this.#ref
        if (!this.#flags.not || message === null) this.#assert(err instanceof type, 'be an error with ' + (type.name || 'provided') + ' type')
        if (message !== null) {
            const error: string = messageOf(err)
            this.#assert(matchesMessage(error, message), 'be an error with specified message', error, message)
        }
        return this
    }

    //Values
    public true(): this {
        return this.#assert(this.#ref === true, 'be true')
    }

    public false(): this {
        return this.#assert(this.#ref === false, 'be false')
    }

    public null(): this {
        return this.#assert(this.#ref === null, 'be null')
    }

    public undefined(): this {
        return this.#assert(this.#ref === undefined, 'be undefined')
    }

    public NaN(): this {
        return this.#assert(Number.isNaN(this.#ref), 'be NaN')
    }

    public include(...args: unknown[]): this {
        this.#usage(args.length === 1, 'Can only assert include with a single parameter')
        this.#flags.deep = !this.#flags.shallow
        this.#flags.part = Object.prototype.hasOwnProperty.call(this.#flags, 'part') ? this.#flags.part : false
        return this.#assert(contain(this.#ref, args[0], this.#flags), 'include ' + display(args[0]))
    }

    public includes(...args: unknown[]): this {
        return this.include(...args)
    }

    public contain(...args: unknown[]): this {
        return this.include(...args)
    }

    public contains(...args: unknown[]): this {
        return this.include(...args)
    }

    public endWith(value: string): this {
        this.#usage(typeof this.#ref === 'string' && typeof value === 'string', 'Can only assert endsWith on a string, with a string')
        return this.#assert((this.#ref as string).slice(-value.length) === value, 'endWith ' + display(value))
    }

    public endsWith(value: string): this {
        return this.endWith(value)
    }

    public startWith(value: string): this {
        this.#usage(typeof this.#ref === 'string' && typeof value === 'string', 'Can only assert startsWith on a string, with a string')
        return this.#assert((this.#ref as string).slice(0, value.length) === value, 'startWith ' + display(value))
    }

    public startsWith(value: string): this {
        return this.startWith(value)
    }

    public exist(): this {
        return this.#assert(this.#ref !== null && this.#ref !== undefined, 'exist')
    }

    public exists(): this {
        return this.exist()
    }

    #lengthOf(): number {
        const ref: { length?: number } = this.#ref as { length?: number }
        return ref.length !== undefined ? ref.length : Object.keys(ref).length
    }

    public empty(): this {
        this.#usage(typeof this.#ref === 'object' || typeof this.#ref === 'string', 'Can only assert empty on object, array or string')
        return this.#assert(!this.#lengthOf(), 'be empty')
    }

    public length(size: number): this {
        this.#usage((typeof this.#ref === 'object' && this.#ref !== null) || typeof this.#ref === 'string', 'Can only assert length on object, array or string')
        const length: number = this.#lengthOf()
        return this.#assert(length === size, 'have a length of ' + size, length)
    }

    public equal(value: unknown, options: DeepEqualOptions = {}): this {
        const deepSettings: DeepEqualOptions = applyToDefaults({prototype: settings.comparePrototypes, deepFunction: true}, options) as DeepEqualOptions
        const result: boolean = this.#flags.shallow ? this.#ref === value : deepEqual(this.#ref, value, deepSettings)
        return this.#assert(result, `equal specified value: ${display(value)}`, this.#ref, value)
    }

    public equals(value: unknown, options?: DeepEqualOptions): this {
        return this.equal(value, options)
    }

    //Comparisons
    public above(value: number): this {
        return this.#assert((this.#ref as number) > value, 'be above ' + value)
    }

    public greaterThan(value: number): this {
        return this.above(value)
    }

    public least(value: number): this {
        return this.#assert((this.#ref as number) >= value, 'be at least ' + value)
    }

    public min(value: number): this {
        return this.least(value)
    }

    public below(value: number): this {
        return this.#assert((this.#ref as number) < value, 'be below ' + value)
    }

    public lessThan(value: number): this {
        return this.below(value)
    }

    public most(value: number): this {
        return this.#assert((this.#ref as number) <= value, 'be at most ' + value)
    }

    public max(value: number): this {
        return this.most(value)
    }

    public within(from: number, to: number): this {
        return this.#assert((this.#ref as number) >= from && (this.#ref as number) <= to, 'be within ' + from + '..' + to)
    }

    public range(from: number, to: number): this {
        return this.within(from, to)
    }

    public between(from: number, to: number): this {
        return this.#assert((this.#ref as number) > from && (this.#ref as number) < to, 'be between ' + from + '..' + to)
    }

    public about(value: number, delta: number): this {
        this.#usage(typeOf(this.#ref) === 'number', 'Can only assert about on numbers')
        this.#usage(typeOf(value) === 'number' && typeOf(delta) === 'number', 'About assertion requires two number arguments')
        return this.#assert(Math.abs((this.#ref as number) - value) <= delta, 'be about ' + value + ' ±' + delta)
    }

    public instanceof(type: ErrorType): this {
        return this.#assert(this.#ref instanceof type, 'be an instance of ' + (type.name || 'provided type'))
    }

    public instanceOf(type: ErrorType): this {
        return this.instanceof(type)
    }

    public match(regex: RegExp): this {
        return this.#assert(regex.exec(this.#ref as string), 'match ' + regex)
    }

    public matches(regex: RegExp): this {
        return this.match(regex)
    }

    public satisfy(validator: (value: unknown) => unknown): this {
        return this.#assert(validator(this.#ref), 'satisfy rule')
    }

    public satisfies(validator: (value: unknown) => unknown): this {
        return this.satisfy(validator)
    }

    //Errors
    public throw(...args: unknown[]): unknown {
        this.#usage(typeof this.#ref === 'function', 'Can only assert throw on functions')
        this.#usage(!this.#flags.not || !args.length, 'Cannot specify arguments when expecting not to throw')
        const {type, message} = typeAndMessage(args)
        try {
            (this.#ref as () => unknown)()
        } catch (err) {
            if (type) this.#assert(err instanceof type, 'throw ' + (type.name || 'provided type'))
            if (message !== null) {
                const error: string = messageOf(err)
                this.#assert(matchesMessage(error, message), 'throw an error with specified message', error, message)
            }
            this.#assert(true, 'throw an error', err)
            return err
        }
        return this.#assert(false, 'throw an error')
    }

    public throws(...args: unknown[]): unknown {
        return this.throw(...args)
    }

    public async reject(...args: unknown[]): Promise<unknown> {
        this.#usage(isPromise(this.#ref), 'Can only assert reject on promises')
        const {type, message} = typeAndMessage(args)
        let thrown: unknown = null
        try {
            await this.#ref
        } catch (err) {
            thrown = err
        }
        this.#usage(!this.#flags.not || !args.length, 'Cannot specify arguments when expecting not to reject')
        if (thrown) {
            this.#usage(args.length < 2 || message, 'Can not assert with invalid message argument type')
            this.#usage(args.length < 1 || message !== null || typeof type === 'function', 'Can not assert with invalid type argument')
            if (type) this.#assert(thrown instanceof type, 'reject with ' + (type.name || 'provided type'))
            if (message !== null) {
                const error: string = messageOf(thrown)
                this.#assert(matchesMessage(error, message), 'reject with an error with specified message', error, message)
            }
            this.#assert(thrown, 'reject with an error', thrown)
        }
        this.#assert(thrown, 'reject with an error')
        return thrown
    }

    public async rejects(...args: unknown[]): Promise<unknown> {
        return this.reject(...args)
    }
}

/**
 * Create an assertion on a value
 * @param value
 * @param prefix
 */
export function expect(value: unknown, prefix?: string): Assertion {
    return new Assertion(value, prefix)
}

/**
 * Fail the current test
 * @param message
 */
export function fail(message: string): never {
    throw new Error(message)
}
