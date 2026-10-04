import {BaseObject} from '../lib/base/BaseObject.js'

/**
 * The declaration of an object in the module options: its class, and its options under any other key.
 */
export interface BaseObjectOptions {
    /**
     * The class of the object, an {@link BaseObject} subclass.
     */
    class: typeof BaseObject

    [prop: string]: any
}

/**
 * The declaration of an object whose options are typed: the options `T` with the class.
 */
export type ObjectOptions<T> = T & BaseObjectOptions

/**
 * A function building the declaration of an object from its typed options, adding its class (the packages export
 * such builders for their objects).
 */
export type ObjectOptionsBuilder<T> = (options: T) => ObjectOptions<T>
