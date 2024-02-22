import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectInject} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Property Decorator
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectInject(target, propertyKey)
}
