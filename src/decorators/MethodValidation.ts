import {ArraySchema, Schema, ValidationOptions, Validator} from '../utils/Validator.js'
import {isAsyncFunction} from 'util/types'
import {InvalidMethodReturnException} from '../exceptions/InvalidMethodReturnException.js'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'

const defaultValidationOptions: ValidationOptions = {
    abortEarly: true,
    cache: false,
    allowUnknown: true,
    stripUnknown: true,
    debug: false
}

/**
 * 方法接收参数验证装饰器
 * @param argumentSchemas
 * @param options
 * @constructor
 */
export const Accept = (argumentSchemas: Schema | Schema[], options?: ValidationOptions) => (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => any | Promise<any>>) => {
    options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
    descriptor.writable = false
    const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value as any
    const schema: ArraySchema = Validator.Array().ordered(...(Array.isArray(argumentSchemas) ? argumentSchemas : [argumentSchemas]))
    const argumentSchemaLength: number = Array.isArray(argumentSchemas) ? argumentSchemas.length : 1
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]) {
            try {
                args = await schema.concat(Validator.Array().ordered(...new Array(args.length - argumentSchemaLength).fill(Validator.Any()))).validateAsync(args, options)
            } catch (e) {
                throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {propertyKey: propertyKey, reason: (e as Error).message})
            }
            return originalMethod.apply(this, args)
        }
    } else {
        descriptor.value = function (...args: any[]) {
            const {error, value} = schema.concat(Validator.Array().ordered(...new Array(args.length - argumentSchemaLength).fill(Validator.Any()))).validate(args, options)
            if (error) {
                throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {propertyKey: propertyKey, reason: error.message})
            }
            return originalMethod.apply(this, value)
        }
    }
    return descriptor
}

/**
 * 方法返回参数验证装饰器
 * @param returnSchema
 * @param options
 * @constructor
 */
export const Return = (returnSchema: Schema, options?: ValidationOptions) => (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => any | Promise<any>>) => {
    options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
    descriptor.writable = false
    const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value as any
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]) {
            const asyncResult = await originalMethod.apply(this, args)
            try {
                return await returnSchema.validateAsync(asyncResult, options)
            } catch (e) {
                throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {propertyKey: propertyKey, reason: (e as Error).message})
            }
        }
    } else {
        descriptor.value = function (...args: any[]) {
            const syncResult = originalMethod.apply(this, args)
            const {error, value} = returnSchema.validate(syncResult, options)
            if (error) {
                throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {propertyKey: propertyKey, reason: error.message})
            }
            return value
        }
    }
    return descriptor
}
