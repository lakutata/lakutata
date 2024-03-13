import {isAsyncFunction} from 'node:util/types'
import {InvalidAssistantFunctionTypeException} from '../../../exceptions/InvalidAssistantFunctionTypeException.js'

/**
 * Register a function which will run before target method
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param beforeFunction
 * @constructor
 */
export function RegisterBeforeFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>, beforeFunction: (this: ClassPrototype, ...args: Parameters<Method>) => Promise<Parameters<Method> | void> | Parameters<Method> | void): TypedPropertyDescriptor<Method> {
    descriptor.value = generateModifyMethod(target, applicabilityCheck(descriptor.value, beforeFunction), {
        before: beforeFunction
    })
    return descriptor
}

/**
 * Register a function which will run after target method
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param afterFunction
 * @constructor
 */
export function RegisterAfterFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>, afterFunction: (this: ClassPrototype, result: Awaited<ReturnType<Method>>) => Promise<ReturnType<Method> | void> | ReturnType<Method> | void): TypedPropertyDescriptor<Method> {
    descriptor.value = generateModifyMethod(target, applicabilityCheck(descriptor.value, afterFunction), {
        after: afterFunction
    })
    return descriptor
}

/**
 * Generate modified method
 * @param target
 * @param originalMethod
 * @param assistantFunction
 */
function generateModifyMethod<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, originalMethod: (...args: any[]) => Promise<any> | any, assistantFunction: {
    before?: (this: ClassPrototype, ...args: Parameters<Method>) => Promise<Parameters<Method> | void> | Parameters<Method> | void
    after?: (this: ClassPrototype, result: Awaited<ReturnType<Method>>) => Promise<ReturnType<Method> | void> | ReturnType<Method> | void
}): Method {
    let modifiedMethod: Method & any
    if (isAsyncFunction(originalMethod)) {
        modifiedMethod = async function (this: ClassPrototype, ...args: Parameters<Method>) {
            if (assistantFunction.before) await assistantFunction.before?.call(target, ...args)
            const result = await originalMethod(...args)
            if (assistantFunction.after) await assistantFunction.after?.call(target, result)
        }
    } else {
        modifiedMethod = function (this: ClassPrototype, ...args: Parameters<Method>) {
            if (assistantFunction.before) assistantFunction.before?.call(target, ...args)
            const result = originalMethod(...args)
            if (assistantFunction.after) assistantFunction.after?.call(target, result)
        }
    }
    return modifiedMethod
}

/**
 * Whether assistant function applicable to target method
 */
function applicabilityCheck(targetMethod: any, assistantFunction: any): (...args: any[]) => Promise<any> | any {
    if (!targetMethod) throw new InvalidAssistantFunctionTypeException('Target method is undefined')
    if (isAsyncFunction(targetMethod)) return targetMethod
    if (!isAsyncFunction(assistantFunction)) return targetMethod
    throw new InvalidAssistantFunctionTypeException('Assistant function must not be async function when target method is not async function')
}
