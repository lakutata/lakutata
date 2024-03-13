import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {RegisterAfterFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

export function After<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(afterFunc: (this: ClassPrototype, result: Awaited<ReturnType<Method>>) => Promise<ReturnType<Method> | void> | ReturnType<Method> | void): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => RegisterAfterFunction<ClassPrototype, Method>(target, propertyKey, descriptor, afterFunc)
}
