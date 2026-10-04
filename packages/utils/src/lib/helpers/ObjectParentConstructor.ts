import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get the parent class of a class: the one it `extends`.
 * @param target A class. The types only accept a class, but an object passed with a cast gives its class's parent
 * (`ObjectParentConstructor(new Admin() as any)` is `ObjectParentConstructor(Admin)`).
 * @returns The parent class, or `null` for a class which extends nothing (a base class, `Object`), a plain object, or a
 * function which is not a class (an arrow function).
 * @example
 * ```typescript
 * import {ObjectParentConstructor} from 'lakutata/utils'
 *
 * class User {
 * }
 *
 * class Admin extends User {
 * }
 *
 * console.log(ObjectParentConstructor(Admin) === User, ObjectParentConstructor(User))
 * //true null
 * ```
 */
export function ObjectParentConstructor<ClassConstructor extends Function>(target: ClassConstructor): Function | null
export function ObjectParentConstructor<ClassPrototype extends Object>(target: IConstructor<ClassPrototype>): Function | null
export function ObjectParentConstructor(target: any): Function | null {
    const rootProto: unknown = Symbol.constructor.prototype.constructor.__proto__
    const constructor: Function = (!!target[Symbol.hasInstance] && target.prototype) ? target : target.constructor
    const proto: IConstructor<any> = constructor.prototype.constructor.__proto__
    return proto === rootProto ? null : proto
}
