import {format as utilFormat} from 'node:util'
import {GetAppId, GetAppName} from './BasicInfo.js'
import {Templating} from '@lakutata/utils/Templating'
import {As} from '@lakutata/utils/As'
import {CamelCase} from '@lakutata/utils/CamelCase'
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
 * 异常抽象类
 */
export abstract class Exception extends Error {
    public abstract errno: number | string
    public readonly appId: string = GetAppId()
    public readonly appName: string = GetAppName()
    public readonly errMsg: string
    public readonly err: string
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
            try {
                this.message = Templating(template, templatingArgs, {ignoreMissing: true})
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
            const message: string = CamelCase(this.name).toLowerCase()
            this.message = `${message.charAt(0).toUpperCase()}${message.slice(1)}`
        }
        this.errMsg = this.message
        this.err = this.name
    }

    /**
     * 获取错误名称
     * @returns {string}
     */
    public get name(): string {
        return this.constructor.name
    }
}
