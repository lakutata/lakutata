import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'

/**
 * Property Decorator
 * @constructor
 */
export function Configurable<ClassPrototype extends BaseObject>(): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => {
        //todo
    }
}
