/**
 * Tell whether a value is a class (or a constructor function) extending a base class, directly or not. The base class
 * is not its own subclass, and an instance of the subclass is not a subclass. It gives the same result as
 * `DTO.isValid(value, DTO.Class(base))`, without building a validation schema.
 * @param value The value to test, of any type; a value which is not a function, or a function without `prototype` (an
 * arrow function), gives `false`.
 * @param base The base class.
 * @returns `true` when `value` extends `base`, `false` otherwise.
 * @throws {TypeError} When `base` is not callable or its `prototype` is not an object (`instanceof` rejects it), and
 * `value` is a function with a `prototype`.
 * @example
 * ```typescript
 * import {isSubclassOf} from 'lakutata/utils'
 *
 * class Animal {}
 * class Dog extends Animal {}
 *
 * console.log(isSubclassOf(Dog, Animal), isSubclassOf(Animal, Animal), isSubclassOf(new Dog(), Animal))
 * //true false false
 * ```
 */
export function isSubclassOf(value: unknown, base: Function): boolean {
    return typeof value === 'function' && !!value.prototype && value.prototype instanceof base
}
