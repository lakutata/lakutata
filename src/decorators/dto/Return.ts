import {DTO} from '../../lib/core/DTO.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {SetMethodReturnValueValidator} from '../../lib/base/internal/MethodValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Property Decorator
 * @param def
 * @constructor
 */
export function Return<ClassPrototype, DTOConstructor extends typeof DTO>(def: DTOConstructor | Schema): TMethodDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<ClassPrototype>) => SetMethodReturnValueValidator(target, propertyKey, descriptor, def)
}
