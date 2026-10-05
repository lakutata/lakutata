import {DTO} from './DTO.js'
import {isDTO} from './ObjectSchemaValidation.js'
import {isAsyncFunction} from 'node:util/types'
import {InvalidMethodAcceptException} from '../../exceptions/dto/InvalidMethodAcceptException.js'
import {InvalidMethodReturnException} from '../../exceptions/dto/InvalidMethodReturnException.js'
import {Schema} from '../validation/types/Schema.js'
import {ArraySchema} from '../validation/interfaces/ArraySchema.js'
import {As} from '@lakutata/utils/As'
import {withCause} from '../helpers/internal/WithCause.js'

/**
 * For validate method accept arguments
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param defs
 * @constructor
 */
export function setMethodAcceptArgumentsValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>, defs: (DTOConstructor | Schema)[]): TypedPropertyDescriptor<any> {
    const argumentSchemas: Schema[] = []
    defs.forEach((def: DTOConstructor | Schema) => argumentSchemas.push(isDTO(As<DTOConstructor>(def)) ? As<DTOConstructor>(def).Schema() : As<Schema>(def)))
    descriptor.writable = false
    const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value
    //The arguments may be undefined (an optional argument given as undefined): sparse, each one checked by its schema
    const schema: ArraySchema = DTO.Array().sparse(true).ordered(...argumentSchemas)
    const argumentSchemaLength: number = Array.isArray(argumentSchemas) ? argumentSchemas.length : 1
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]): Promise<any> {
            const argumentCount: number = args.length - argumentSchemaLength
            try {
                args = await DTO.validateAsync(args, schema.concat(DTO.Array().sparse(true).ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(DTO.Any()))))
            } catch (e) {
                throw withCause(new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                }), e)
            }
            return originalMethod.apply(this, args)
        }
    } else {
        descriptor.value = function (...args: any[]): any {
            const argumentCount: number = args.length - argumentSchemaLength
            try {
                args = DTO.validate(args, schema.concat(DTO.Array().sparse(true).ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(DTO.Any()))))
            } catch (e) {
                throw withCause(new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                }), e)
            }
            return originalMethod.apply(this, args)
        }
    }
    return descriptor
}

/**
 * The metadata key of the schema of the return value of a method
 */
const METHOD_RETURN_SCHEMA: symbol = Symbol('DTO.METHOD.RETURN.SCHEMA')

/**
 * Get the schema a method's result is validated against, declared with `@Return` (the schema of a DTO class given to
 * `@Return`); used by the entrypoint channels describing the results of their actions. It is looked up through the
 * prototype chain: a subclass gets the schema of its parent's method, even when it overrides the method.
 * @param target The prototype of the class.
 * @param propertyKey The name of the method.
 * @returns The schema, or `undefined` when the method has no `@Return`.
 * @example
 * ```typescript
 * import {Component, DTO} from 'lakutata'
 * import {getMethodReturnSchema, Return} from 'lakutata/decorator/dto'
 *
 * class Clock extends Component {
 *     @Return(DTO.Number().integer().required())
 *     public async now(): Promise<number> {
 *         return Date.now()
 *     }
 * }
 *
 * //The description of the result, e.g. for a generated API document
 * console.log(getMethodReturnSchema(Clock.prototype, 'now')?.describe())
 * ```
 */
export function getMethodReturnSchema(target: object, propertyKey: string | symbol): Schema | undefined {
    return Reflect.getMetadata(METHOD_RETURN_SCHEMA, target, propertyKey)
}

/**
 * For validate method return value
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param def
 * @constructor
 */
export function setMethodReturnValueValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>, def: DTOConstructor | Schema): TypedPropertyDescriptor<any> {
    const schema: Schema = isDTO(As<DTOConstructor>(def)) ? As<DTOConstructor>(def).Schema() : As<Schema>(def)
    Reflect.defineMetadata(METHOD_RETURN_SCHEMA, schema, As<object>(target), propertyKey)
    descriptor.writable = false
    const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]): Promise<any> {
            const asyncResult = await originalMethod.apply(this, args)
            if (asyncResult === undefined) throw new InvalidMethodReturnException('Method [{propertyKey}] return undefined', {
                propertyKey: propertyKey
            })
            try {
                return await DTO.validateAsync(asyncResult, schema)
            } catch (e) {
                throw withCause(new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                }), e)
            }
        }
    } else {
        descriptor.value = function (...args: any[]) {
            const syncResult = originalMethod.apply(this, args)
            if (syncResult === undefined) throw new InvalidMethodReturnException('Method [{propertyKey}] return undefined', {
                propertyKey: propertyKey
            })
            try {
                return DTO.validate(syncResult, schema)
            } catch (e) {
                throw withCause(new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                }), e)
            }
        }
    }
    return descriptor
}
