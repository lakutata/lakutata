import {MethodDecorator} from '../../types/MethodDecorator.js'
import {AfterFunction, RegisterAfterFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

/**
 * Run a function after each call of the decorated method, with its result. The function is called with the instance as
 * `this`; a value it returns other than `undefined` replaces the result, `undefined` keeps it. Several `@After` on a
 * method run in turn, each one receiving the result left by the previous one; an error thrown by the function is thrown
 * by the call.
 * @param afterFunc The function receiving the method's result (awaited when the method is async), and returning a
 * value of the method's return type (a promise for an async method). It may be async only when the method is async.
 * @returns The method decorator.
 * @throws {InvalidAssistantFunctionTypeException} When the class is defined, if `afterFunc` is async and the method is
 * not, or if the decorated member is not a method.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {After} from 'lakutata/decorator/asst'
 *
 * class Prices extends Component {
 *     //The prices are rounded to cents, whatever their computation
 *     @After(async function (this: Prices, price: number): Promise<number> {
 *         return Math.round(price * 100) / 100
 *     })
 *     public async withTax(price: number): Promise<number> {
 *         return price * 1.196
 *     }
 * }
 * ```
 */
export function After<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(afterFunc: AfterFunction<ClassPrototype, Method>): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => RegisterAfterFunction<ClassPrototype, Method>(target, propertyKey, descriptor, afterFunc)
}
