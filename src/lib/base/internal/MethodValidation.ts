import {DTO} from '../../core/DTO.js'
import {Schema} from 'joi'
import {IsDTO} from './ObjectSchemaValidation.js'
import {As} from '../func/As.js'

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
    defs.forEach((def: DTOConstructor | Schema) => argumentSchemas.push(IsDTO(As<DTOConstructor>(def)) ? As<DTOConstructor>(def).schema : As<Schema>(def)))
    console.log(argumentSchemas)
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
