import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectInjectItem} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Property Decorator
 * @param name
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(name?: string | symbol): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectInjectItem(target, propertyKey, name ? name : propertyKey)
}
