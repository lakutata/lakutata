import {As} from './As.js'
import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get the class an object was created by: its `constructor` property, as inherited from its prototype.
 * @param target An object (a class instance, a plain object, an array). Its `constructor` property is read as is: an
 * object which overrides it gives that value, and an object without prototype (`Object.create(null)`) gives
 * `undefined` despite the return type.
 * @returns The constructor: the class for an instance, `Object` for a plain object.
 * @example
 * ```typescript
 * import {objectConstructor} from 'lakutata/utils'
 *
 * class User {
 * }
 *
 * console.log(objectConstructor(new User()) === User, objectConstructor({}) === Object)
 * //true true
 * ```
 */
export function objectConstructor<objectPrototype extends Object>(target: objectPrototype): IConstructor<objectPrototype> {
    return As<IConstructor<objectPrototype>>(target.constructor)
}

