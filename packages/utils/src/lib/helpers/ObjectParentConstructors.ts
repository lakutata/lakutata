import {ObjectParentConstructor} from './ObjectParentConstructor.js'
import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get the ancestors of a class: its parent, the parent's parent, and so on.
 * @param target A class. The types only accept a class, but an object passed with a cast gives its class's ancestors.
 * @returns The ancestor classes, the nearest first, without the class itself and without `Object`; an empty array for a
 * class which extends nothing.
 * @example
 * ```typescript
 * import {ObjectParentConstructors} from 'lakutata/utils'
 *
 * class Entity {
 * }
 *
 * class User extends Entity {
 * }
 *
 * class Admin extends User {
 * }
 *
 * console.log(ObjectParentConstructors(Admin).map((parent: Function): string => parent.name))
 * //['User', 'Entity']
 * ```
 */
export function ObjectParentConstructors<ClassConstructor extends Function>(target: ClassConstructor): Function[]
export function ObjectParentConstructors<ClassPrototype extends Object>(target: IConstructor<ClassPrototype>): Function[]
export function ObjectParentConstructors(target: any): Function[] {
    const parentConstructors: Function[] = []
    let parentConstructor: Function | null = ObjectParentConstructor(target)
    while (parentConstructor) {
        parentConstructors.push(parentConstructor)
        parentConstructor = ObjectParentConstructor(parentConstructor)
    }
    return parentConstructors
}
