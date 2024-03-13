import {DTO} from '../../lib/core/DTO.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {SetMethodAcceptArgumentsValidator} from '../../lib/base/internal/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Method Decorator
 * @param defs
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO, Method>(...defs: (DTOConstructor | Schema)[]): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => SetMethodAcceptArgumentsValidator(target, propertyKey, descriptor, defs)
}
