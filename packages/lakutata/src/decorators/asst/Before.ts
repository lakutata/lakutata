import {MethodDecorator} from '../../types/MethodDecorator.js'
import {BeforeFunction, RegisterBeforeFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

/**
 * Method Decorator
 * @param beforeFunc
 * @constructor
 */
export function Before<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(beforeFunc: BeforeFunction<ClassPrototype, Method>): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => RegisterBeforeFunction<ClassPrototype, Method>(target, propertyKey, descriptor, beforeFunc)
}
