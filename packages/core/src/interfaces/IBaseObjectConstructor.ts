import {BaseObject} from '../lib/base/BaseObject.js'

type BaseObjectConstructor = typeof BaseObject

/**
 * A {@link BaseObject} subclass creating objects of type `T`: the type of the classes given to the container
 * (`getObject(TheClass)`, `@Inject(TheClass)`).
 */
export interface IBaseObjectConstructor<T = any> extends BaseObjectConstructor {
    new(...args: any[]): T
}
