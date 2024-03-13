import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {RegisterBeforeFunction} from '../../lib/base/internal/MethodAssistantFunction.js'

export function Before<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(beforeFunc: (this: ClassPrototype, ...args: Parameters<Method>) => Promise<Parameters<Method> | void> | Parameters<Method> | void): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => RegisterBeforeFunction<ClassPrototype, Method>(target, propertyKey, descriptor, beforeFunc)
}
