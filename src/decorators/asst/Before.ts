import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {BeforeFunction, RegisterBeforeFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

/**
 * Method Decorator
 * @param beforeFunc
 * @constructor
 */
export function Before<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(beforeFunc: BeforeFunction<ClassPrototype,Method>): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => RegisterBeforeFunction<ClassPrototype, Method>(target, propertyKey, descriptor, beforeFunc)
}
