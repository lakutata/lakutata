import {type BaseObject} from '../lib/base/BaseObject.js'

type BaseObjectConstructor = typeof BaseObject

export interface IBaseObjectConstructor<T = any> extends BaseObjectConstructor {
    new(...args: any[]): T

    [prop: string]: any
}
