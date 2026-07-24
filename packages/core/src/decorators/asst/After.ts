import {MethodDecorator} from '../../types/MethodDecorator.js'
import {AfterFunction, RegisterAfterFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

/**
 * Method Decorator
 * @param afterFunc
 * @constructor
 */
export function After<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(afterFunc: AfterFunction<ClassPrototype, Method>): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => RegisterAfterFunction<ClassPrototype, Method>(target, propertyKey, descriptor, afterFunc)
}
