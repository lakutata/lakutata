import {type DTO} from '../../lib/core/DTO.js'
import {type MethodDecorator} from '../../types/MethodDecorator.js'
import {SetMethodAcceptArgumentsValidator} from '../../lib/base/internal/MethodValidation.js'
import {type Schema} from '../../lib/validation/types/Schema.js'

/**
 * Method Decorator
 * @param defs
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO, Method>(...defs: (DTOConstructor | Schema)[]): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => SetMethodAcceptArgumentsValidator(target, propertyKey, descriptor, defs)
}
