import {Schema} from 'joi'
import {DTO} from '../../lib/core/DTO.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'

/**
 * Property Decorator
 * @param defs
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO>(...defs: (DTOConstructor | Schema)[]): TMethodDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<ClassPrototype>) => {
        //TODO
    }
}
