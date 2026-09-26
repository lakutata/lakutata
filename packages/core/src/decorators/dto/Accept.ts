import {DTO} from '../../lib/dto/DTO.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {SetMethodAcceptArgumentsValidator} from '../../lib/dto/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Method Decorator
 * @param defs
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO, Method>(...defs: (DTOConstructor | Schema)[]): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<any> => SetMethodAcceptArgumentsValidator(target, propertyKey, descriptor, defs)
}
