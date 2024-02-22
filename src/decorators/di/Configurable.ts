import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectConfigurableProperty} from '../../lib/base/internal/ObjectConfigure.js'

/**
 * Property Decorator
 * @constructor
 */
export function Configurable<ClassPrototype extends BaseObject>(): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectConfigurableProperty(target, propertyKey)
}
