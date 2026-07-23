import {BaseObject} from '../lib/base/BaseObject.js'

export interface BaseObjectOptions {
    class: typeof BaseObject

    [prop: string]: any
}

export type ObjectOptions<T> = T & BaseObjectOptions

export type ObjectOptionsBuilder<T> = (options: T) => ObjectOptions<T>
