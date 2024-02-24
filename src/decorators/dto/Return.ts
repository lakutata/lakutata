import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {Schema} from 'joi'
import {DTO} from '../../lib/core/DTO.js'

/**
 * Property Decorator
 * @constructor
 */
export function Return<ClassPrototype, DTOConstructor extends typeof DTO>(def: DTOConstructor | Schema): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        //TODO
    }
}
