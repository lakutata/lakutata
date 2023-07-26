import {ArraySchema, Schema, ValidationOptions, Validator} from '../lib/Validator.js'
import {isAsyncFunction} from 'util/types'

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
    const errorMessages: string[] = [`Method [${propertyKey}] accept argument`]
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]) {
            try {
                args = await schema.concat(Validator.Array().ordered(...new Array(args.length - argumentSchemaLength).fill(Validator.Any()))).validateAsync(args, options)
            } catch (e) {
                errorMessages.push((e as Error).message)
                const errorMessage: string = errorMessages.join(' ')
                //todo throw new InvalidMethodAcceptException((e as Error).message)
                throw new Error(errorMessage)
            }
            return originalMethod.apply(this, args)
        }
    } else {
        descriptor.value = function (...args: any[]) {
            const {error, value} = schema.concat(Validator.Array().ordered(...new Array(args.length - argumentSchemaLength).fill(Validator.Any()))).validate(args, options)
            if (error) {
                errorMessages.push(error.message)
                const errorMessage: string = errorMessages.join(' ')
                //todo throw new InvalidMethodAcceptException((e as Error).message)
                throw new Error(errorMessage)
            }
            return originalMethod.apply(this, value)
        }
    }
    return descriptor
}
