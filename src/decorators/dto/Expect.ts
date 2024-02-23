import {DTO} from '../../lib/core/DTO.js'
import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'

/**
 * Property Decorator
 * @constructor
 */
export function Expect<ClassPrototype extends DTO>(): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        //TODO
    }
}
