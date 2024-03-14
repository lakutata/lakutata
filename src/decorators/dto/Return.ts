import {DTO} from '../../lib/core/DTO.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {SetMethodReturnValueValidator} from '../../lib/base/internal/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Method Decorator
 * @param def
 * @constructor
 */
export function Return<ClassPrototype, DTOConstructor extends typeof DTO, Method>(def: DTOConstructor | Schema): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => SetMethodReturnValueValidator(target, propertyKey, descriptor, def)
}
