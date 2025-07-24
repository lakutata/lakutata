import {BaseObject} from '../lib/base/BaseObject.js'

export interface IObjectOptions {
    class: typeof BaseObject

    [prop: string]: any
}