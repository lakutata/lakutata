import {format as utilFormat} from 'node:util'
import {getAppId, getAppName} from './BasicInfo.js'
import {templating} from '@lakutata/utils/Templating'
import {As} from '@lakutata/utils/As'
import {camelCase} from '@lakutata/utils/CamelCase'
import {DevNull} from '@lakutata/utils/DevNull'

/**
 * The placeholders of util.format() consuming an argument
 */
const PLACEHOLDERS: string = 'sdifjoOc'

/**
 * Format the placeholders of a message as util.format() of Node.js (%s, %d, %i, %f, %j, %o, %O, %c, %%): an unknown
 * placeholder, a placeholder without argument and a % alone are kept; the arguments left are not appended (they are
 * the data of the templates too); a placeholder its argument cannot be formatted by (%j of a bigint) is kept, the
 * creation of an exception never throws
 * @param template
 * @param args
 */
function format(template: string, ...args: any[]): string {
    if (!args.length) return template
    let result: string = ''
    let lastPosition: number = 0
    let argument: number = 0
    for (let i: number = 0; i < template.length - 1; i++) {
        if (template[i] !== '%') continue
        const placeholder: string = template[++i]
        if (argument < args.length && PLACEHOLDERS.includes(placeholder)) {
            let formatted: string
            try {
                formatted = placeholder === 'c' ? '' : utilFormat(`%${placeholder}`, args[argument])
            } catch {
                formatted = `%${placeholder}`
            }
            result += template.slice(lastPosition, i - 1) + formatted
            argument++
            lastPosition = i + 1
        } else if (placeholder === '%') {
            result += template.slice(lastPosition, i)
            lastPosition = i + 1
        }
    }
    return result + template.slice(lastPosition)
}

/**
 * The parameters of the template of the message of an exception
 */
const PARAMS: unique symbol = Symbol('EXCEPTION.PARAMS')

/**
 * Read the parameters an exception's message template was formatted with (`new XxxException('Order {id} not found',
 * {id: 1})`), to translate the message into another language with the same values.
 * @param exception The error to read; any error is accepted.
 * @returns The object given as the single parameter, the parameters as an array when several (or a single non-object
 * one) were given, or undefined when the exception was created without parameters or is not an {@link Exception}.
 * @example
 * ```typescript
 * import {Exception, exceptionParams} from 'lakutata'
 *
 * class OrderNotFoundException extends Exception {
 *     public errno: string = 'E_ORDER_NOT_FOUND'
 * }
 *
 * const error: OrderNotFoundException = new OrderNotFoundException('Order {id} not found', {id: 1})
 * console.log(error.message) //Order 1 not found
 * console.log(exceptionParams(error)) //{id: 1}
 * ```
 */
export function exceptionParams(exception: Error): Record<string, unknown> | unknown[] | undefined {
    return (exception as unknown as Record<symbol, Record<string, unknown> | unknown[] | undefined>)[PARAMS]
}

/**
 * The base class of the framework's exceptions, and of the applications' own: extend it, set its `errno` and, for the
 * errors sent to clients, its `statusCode`. The entrypoints send `errno`, `errMsg` and `statusCode` to the clients, and
 * the HTTP adapters reply with `statusCode`.
 *
 * The message is built from the constructor arguments:
 * - `new XxxException('Order {id} not found', {id: 1})`: a template, its `{name}` placeholders filled from an object, or
 *   its `{0}`, `{1}` placeholders from the parameters given one by one (`new XxxException('{0} of {1}', a, b)`) or from
 *   an array; the `util.format()` placeholders (`%s`, `%d`, `%j`…) are filled from the parameters too. A missing value
 *   leaves its placeholder in the message; building the message never throws.
 * - `new XxxException('Order not found')`: the message as given.
 * - `new XxxException(error)`: the message of another error.
 * - `new XxxException()`: a message made from the class name.
 *
 * The template parameters are kept for the translation of the message, see {@link exceptionParams}.
 * @example
 * ```typescript
 * import {Exception} from 'lakutata'
 *
 * export class OrderNotFoundException extends Exception {
 *     public errno: string = 'E_ORDER_NOT_FOUND'
 *
 *     public readonly statusCode: number = 404
 * }
 *
 * export function findOrder(id: number): never {
 *     throw new OrderNotFoundException('Order {id} not found', {id: id})
 * }
 * ```
 */
export abstract class Exception extends Error {
    /**
     * The error number or code identifying the error to the clients and the logs (`'E_ORDER_NOT_FOUND'`); each
     * subclass sets it.
     */
    public abstract errno: number | string
    /**
     * The ID of the application the exception was created in, "Unknown" before the application's options are loaded.
     */
    public readonly appId: string = getAppId()
    /**
     * The name of the application the exception was created in, "Unknown" before the application's options are loaded.
     */
    public readonly appName: string = getAppName()
    /**
     * The formatted message, a copy of `message` kept as an own property (sent with the error by the entrypoints).
     */
    public readonly errMsg: string
    /**
     * The name of the exception's class (`'OrderNotFoundException'`), a copy of `name` kept as an own property.
     */
    public readonly err: string
    /**
     * The HTTP status the HTTP entrypoints reply with when the exception fails a request; a subclass overrides it
     * (404 for a missing resource…).
     * @default 500
     */
    public readonly statusCode: number = 500

    constructor(template: string, ...params: any[])
    constructor(message: string)
    constructor(error: Error)
    constructor()
    constructor(a?: string | Error, ...b: any[]) {
        super()
        if (b.length) {
            const template: string = a as string
            const templatingArgs: unknown[] | Record<string, any> = b.length > 1 ? b : b[0]
            //Kept for the translations of the message, not an enumerable property (the errors sent are not changed)
            Object.defineProperty(this, PARAMS, {value: b.length > 1 || typeof b[0] !== 'object' || b[0] === null ? b : b[0], enumerable: false})
            try {
                this.message = templating(template, templatingArgs, {ignoreMissing: true})
            } catch (e) {
                this.message = template
                DevNull(e)
            }
            this.message = format(this.message, ...b)
        } else if (a) {
            if (typeof (a) === 'string') {
                //Error message
                this.message = a as string
            } else {
                //Error instance
                this.message = As<Error>(a).message
            }
        } else {
            //Empty message
            const message: string = camelCase(this.name).toLowerCase()
            this.message = `${message.charAt(0).toUpperCase()}${message.slice(1)}`
        }
        this.errMsg = this.message
        this.err = this.name
    }

    /**
     * The name of the exception: the name of its class.
     * @returns The class name.
     */
    public get name(): string {
        return this.constructor.name
    }
}
