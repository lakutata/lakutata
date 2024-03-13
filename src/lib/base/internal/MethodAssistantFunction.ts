import {isAsyncFunction} from 'node:util/types'
import {InvalidAssistantFunctionTypeException} from '../../../exceptions/InvalidAssistantFunctionTypeException.js'
import {As} from '../../functions/As.js'

const ASST_BEFORE_FUNC_SET: symbol = Symbol('ASST.BEFORE.FUNC.SET')
const ASST_AFTER_FUNC_SET: symbol = Symbol('ASST.AFTER.FUNC.SET')
const ASST_MODIFIED: symbol = Symbol('ASST.MODIFIED')
export type BeforeFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown> = (this: ClassPrototype, ...args: Parameters<Method>) => Promise<Parameters<Method> | void> | Parameters<Method> | void
export type AfterFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown> = (this: ClassPrototype, result: Awaited<ReturnType<Method>>) => Promise<ReturnType<Method> | void> | ReturnType<Method> | void

/**
 * Register a function which will run before target method
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param beforeFunction
 * @constructor
 */
export function RegisterBeforeFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>, beforeFunction: BeforeFunction<ClassPrototype, Method>): TypedPropertyDescriptor<Method> {
    descriptor.value = registerAssistantFunctionToMethod(target, propertyKey, applicabilityCheck(descriptor.value, beforeFunction), {
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
export function RegisterAfterFunction<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>, afterFunction: AfterFunction<ClassPrototype, Method>): TypedPropertyDescriptor<Method> {
    descriptor.value = registerAssistantFunctionToMethod(target, propertyKey, applicabilityCheck(descriptor.value, afterFunction), {
        after: afterFunction
    })
    return descriptor
}

/**
 * Register assistant function to method
 * @param target
 * @param propertyKey
 * @param originalMethod
 * @param assistantFunction
 */
function registerAssistantFunctionToMethod<ClassPrototype extends Object, Method extends (...args: any[]) => unknown>(target: ClassPrototype, propertyKey: string | symbol, originalMethod: (...args: any[]) => Promise<any> | any, assistantFunction: {
    before?: BeforeFunction<ClassPrototype, Method>
    after?: AfterFunction<ClassPrototype, Method>
}): Method {
    const beforeFunctionSet: Set<BeforeFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_BEFORE_FUNC_SET, target, propertyKey) || new Set()
    const afterFunctionSet: Set<AfterFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_AFTER_FUNC_SET, target, propertyKey) || new Set()
    if (assistantFunction.before) {
        beforeFunctionSet.add(assistantFunction.before)
        Reflect.defineMetadata(ASST_BEFORE_FUNC_SET, beforeFunctionSet, target, propertyKey)
    }
    if (assistantFunction.after) {
        afterFunctionSet.add(assistantFunction.after)
        Reflect.defineMetadata(ASST_AFTER_FUNC_SET, afterFunctionSet, target, propertyKey)
    }
    if (Reflect.hasOwnMetadata(ASST_MODIFIED, target, propertyKey)) return As<Method>(originalMethod)
    Reflect.defineMetadata(ASST_MODIFIED, true, target, propertyKey)
    let modifiedMethod: Method & any
    if (isAsyncFunction(originalMethod)) {
        modifiedMethod = async function (this: ClassPrototype, ...args: Parameters<Method>) {
            const beforeFunctionSet: Set<BeforeFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_BEFORE_FUNC_SET, target, propertyKey) || new Set()
            const afterFunctionSet: Set<AfterFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_AFTER_FUNC_SET, target, propertyKey) || new Set()
            for (const beforeFunc of beforeFunctionSet) {
                const beforeFuncResult: Parameters<Method> | void = await beforeFunc.call(this, ...args)
                if (beforeFuncResult !== undefined) args = beforeFuncResult
            }
            let result = await originalMethod.call(this, ...args)
            for (const afterFunc of afterFunctionSet) {
                const afterFuncResult: ReturnType<Method> | void = await afterFunc.call(this, result)
                if (afterFuncResult !== undefined) result = afterFuncResult
            }
            return result
        }
    } else {
        modifiedMethod = function (this: ClassPrototype, ...args: Parameters<Method>) {
            const beforeFunctionSet: Set<BeforeFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_BEFORE_FUNC_SET, target, propertyKey) || new Set()
            const afterFunctionSet: Set<AfterFunction<ClassPrototype, Method>> = Reflect.getOwnMetadata(ASST_AFTER_FUNC_SET, target, propertyKey) || new Set()
            for (const beforeFunc of beforeFunctionSet) {
                const beforeFuncResult: Parameters<Method> | void = As<Parameters<Method> | void>(beforeFunc.call(this, ...args))
                if (beforeFuncResult !== undefined) args = beforeFuncResult
            }
            let result = originalMethod.call(this, ...args)
            for (const afterFunc of afterFunctionSet) {
                const afterFuncResult: ReturnType<Method> | void = As<ReturnType<Method> | void>(afterFunc.call(this, result))
                if (afterFuncResult !== undefined) result = afterFuncResult
            }
            return result
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
