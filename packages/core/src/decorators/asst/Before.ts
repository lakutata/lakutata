import {MethodDecorator} from '../../types/MethodDecorator.js'
import {BeforeFunction, registerBeforeFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

/**
 * Run a function before each call of the decorated method, with its arguments. The function is called with the
 * instance as `this`; an array it returns replaces the arguments passed to the method, `undefined` keeps them. Several
 * `@Before` on a method run in turn, each one receiving the arguments left by the previous one; an error thrown by the
 * function is thrown by the call, and the method does not run.
 * @param beforeFunc The function receiving the method's arguments. It may be async only when the method is async.
 * @returns The method decorator.
 * @throws {InvalidAssistantFunctionTypeException} When the class is defined, if `beforeFunc` is async and the method is
 * not, or if the decorated member is not a method.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Before} from 'lakutata/decorator/asst'
 *
 * class Users extends Component {
 *     //The names are looked up trimmed and in lower case
 *     @Before(function (this: Users, name: string): [string] {
 *         return [name.trim().toLowerCase()]
 *     })
 *     public async find(name: string): Promise<string | undefined> {
 *         return name === 'ada' ? 'Ada Lovelace' : undefined
 *     }
 * }
 * ```
 */
export function Before<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(beforeFunc: BeforeFunction<ClassPrototype, Method>): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => registerBeforeFunction<ClassPrototype, Method>(target, propertyKey, descriptor, beforeFunc)
}
