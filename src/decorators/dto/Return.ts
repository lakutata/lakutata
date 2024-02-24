import {Schema} from 'joi'
import {DTO} from '../../lib/core/DTO.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'

/**
 * Property Decorator
 * @param def
 * @constructor
 */
export function Return<ClassPrototype, DTOConstructor extends typeof DTO>(def: DTOConstructor | Schema): TMethodDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<ClassPrototype>) => {
        //TODO
    }
}
