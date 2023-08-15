import 'reflect-metadata'
import pupa from 'pupa'
import {camelCase} from 'camel-case'
import {As} from '../../../Utilities.js'

/**
 * 异常抽象类
 */
export abstract class Exception extends Error {
    public abstract errno: number | string
    public readonly appId: string = process.env.appId ? process.env.appId : 'Unknown'
    public readonly appName: string = process.env.appName ? process.env.appName : 'Unknown'
    public readonly errMsg: string
    public readonly err: string

    constructor(template: string, data: unknown[] | Record<string, any>)
    constructor(message: string)
    constructor(error: Error)
    constructor()
    constructor(a?: string | Error, b?: unknown[] | Record<string, any>) {
        super()
        if (b) {
            const template: string = a as string
            const data: unknown[] | Record<string, any> = b
            //Error template
            try {
                this.message = pupa(template, data, {ignoreMissing: true})
            } catch (e) {
                this.message = 'Unknown (broken exception template or data)'
            }
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
            const message: string = camelCase(this.name, {delimiter: ' '}).toLowerCase()
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
