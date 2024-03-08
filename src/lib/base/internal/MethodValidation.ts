import {DTO} from '../../core/DTO.js'
import {IsDTO} from './ObjectSchemaValidation.js'
import {isAsyncFunction} from 'node:util/types'
import {InvalidMethodAcceptException} from '../../../exceptions/dto/InvalidMethodAcceptException.js'
import {InvalidMethodReturnException} from '../../../exceptions/dto/InvalidMethodReturnException.js'
import {Schema} from '../../validation/types/Schema.js'
import {ArraySchema} from '../../validation/interfaces/ArraySchema.js'
import {As} from '../../functions/As.js'

/**
 * For validate method accept arguments
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param defs
 * @constructor
 */
export function SetMethodAcceptArgumentsValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>, defs: (DTOConstructor | Schema)[]): TypedPropertyDescriptor<any> {
    const argumentSchemas: Schema[] = []
    defs.forEach((def: DTOConstructor | Schema) => argumentSchemas.push(IsDTO(As<DTOConstructor>(def)) ? As<DTOConstructor>(def).Schema() : As<Schema>(def)))
    descriptor.writable = false
    const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value
    const schema: ArraySchema = DTO.Array().ordered(...argumentSchemas)
    const argumentSchemaLength: number = Array.isArray(argumentSchemas) ? argumentSchemas.length : 1
    if (isAsyncFunction(originalMethod)) {
        descriptor.value = async function (...args: any[]): Promise<any> {
            const argumentCount: number = args.length - argumentSchemaLength
            try {
                args = await DTO.validateAsync(args, schema.concat(DTO.Array().ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(DTO.Any()))))
            } catch (e) {
                throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                })
            }
            return originalMethod.apply(this, args)
        }
    } else {
        descriptor.value = function (...args: any[]): any {
            const argumentCount: number = args.length - argumentSchemaLength
            try {
                args = DTO.validate(args, schema.concat(DTO.Array().ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(DTO.Any()))))
            } catch (e) {
                throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                })
            }
            return originalMethod.apply(this, args)
        }
    }
    return descriptor
}

/**
 * For validate method return value
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param def
 * @constructor
 */
export function SetMethodReturnValueValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>, def: DTOConstructor | Schema): TypedPropertyDescriptor<any> {
    const schema: Schema = IsDTO(As<DTOConstructor>(def)) ? As<DTOConstructor>(def).Schema() : As<Schema>(def)
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
                throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                })
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
                throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                    propertyKey: propertyKey,
                    reason: (e as Error).message
                })
            }
        }
    }
    return descriptor
}
