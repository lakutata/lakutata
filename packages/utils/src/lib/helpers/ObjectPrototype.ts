type InferPrototype<ObjectConstruct extends Function> = ObjectConstruct extends new (...args: any[]) => infer objectPrototype ? objectPrototype : never

/**
 * Get the prototype of a class: its `prototype` property, typed as an instance of the class (the object holding its
 * methods, where the decorators store their metadata).
 * @param target A class. A function without `prototype` (an arrow function, a method) gives `undefined`.
 * @returns The class's prototype.
 * @example
 * ```typescript
 * import {objectPrototype} from 'lakutata/utils'
 *
 * class User {
 *     public greet(): string {
 *         return 'hello'
 *     }
 * }
 *
 * const prototype: User = objectPrototype(User)
 * console.log(prototype === User.prototype, typeof prototype.greet)
 * //true function
 * ```
 */
export function objectPrototype<ObjectConstruct extends Function>(target: ObjectConstruct): InferPrototype<ObjectConstruct> {
    return target.prototype
}
