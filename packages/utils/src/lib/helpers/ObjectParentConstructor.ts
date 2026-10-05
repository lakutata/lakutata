import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get the parent class of a class: the one it `extends`.
 * @param target A class. The types only accept a class, but an object passed with a cast gives its class's parent
 * (`objectParentConstructor(new Admin() as any)` is `objectParentConstructor(Admin)`).
 * @returns The parent class, or `null` for a class which extends nothing (a base class, `Object`), a plain object, or a
 * function which is not a class (an arrow function).
 * @example
 * ```typescript
 * import {objectParentConstructor} from 'lakutata/utils'
 *
 * class User {
 * }
 *
 * class Admin extends User {
 * }
 *
 * console.log(objectParentConstructor(Admin) === User, objectParentConstructor(User))
 * //true null
 * ```
 */
export function objectParentConstructor<ClassConstructor extends Function>(target: ClassConstructor): Function | null
export function objectParentConstructor<ClassPrototype extends Object>(target: IConstructor<ClassPrototype>): Function | null
export function objectParentConstructor(target: any): Function | null {
    const rootProto: unknown = Symbol.constructor.prototype.constructor.__proto__
    const constructor: Function = (!!target[Symbol.hasInstance] && target.prototype) ? target : target.constructor
    const proto: IConstructor<any> = constructor.prototype.constructor.__proto__
    return proto === rootProto ? null : proto
}
