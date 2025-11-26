import {GetBasicInfo} from '../internal/BasicInfo.js'
import {Templating} from '../../helpers/Templating.js'
import {As} from '../../helpers/As.js'
import {CamelCase} from '../internal/CamelCase.js'
import {DevNull} from '../../helpers/DevNull.js'
import format from 'format'

/**
 * 异常抽象类
 */
export abstract class Exception extends Error {
    public abstract errno: number | string
    public readonly appId: string = (() => GetBasicInfo().appId)()
    public readonly appName: string = (() => GetBasicInfo().appName)()
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
                console.log('templatingArgs', templatingArgs)
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
