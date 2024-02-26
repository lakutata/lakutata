import {Schema} from 'joi'
import {DTO} from '../../lib/core/DTO.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'
import {SetMethodAcceptArgumentsValidator} from '../../lib/base/internal/MethodValidation.js'

/**
 * Property Decorator
 * @param defs
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO>(...defs: (DTOConstructor | Schema)[]): TMethodDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>) => SetMethodAcceptArgumentsValidator(target, propertyKey, descriptor, defs)
}
