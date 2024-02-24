import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {Schema} from 'joi'
import {DTO} from '../../lib/core/DTO.js'

/**
 * Property Decorator
 * @constructor
 */
export function Accept<ClassPrototype, DTOConstructor extends typeof DTO>(...defs: (DTOConstructor | Schema)[]): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        //TODO
    }
}
