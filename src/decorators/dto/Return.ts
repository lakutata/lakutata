import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'

/**
 * Property Decorator
 * @constructor
 */
export function Accept<ClassPrototype>(): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        //TODO
    }
}
