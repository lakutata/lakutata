import {DTO} from '../../core/DTO.js'
import {Schema} from 'joi'

/**
 * For validate method accept arguments
 * @param target
 * @param propertyKey
 * @param descriptor
 * @param defs
 * @constructor
 */
export function SetMethodAcceptArgumentsValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<ClassPrototype>, defs: (DTOConstructor | Schema)[]): TypedPropertyDescriptor<ClassPrototype> {
    //TODO
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
export function SetMethodReturnValueValidator<ClassPrototype, DTOConstructor extends typeof DTO>(target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<ClassPrototype>, def: DTOConstructor | Schema): TypedPropertyDescriptor<ClassPrototype> {
    //TODO
    return descriptor
}