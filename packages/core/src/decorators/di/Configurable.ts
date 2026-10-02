import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectConfigurableProperty} from '../../lib/base/internal/ObjectConfiguration.js'
import {DTO} from '../../lib/dto/DTO.js'
import {Schema} from '../../lib/validation/types/Schema.js'
import {RemoveObjectInjectItem} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Property Decorator
 * @param schema
 * @param fn
 * @constructor
 */
export function Configurable<ClassPrototype extends BaseObject, DataType>(schema: Schema<DataType> = DTO.Any(), fn?: (this: ClassPrototype, value: DataType) => DataType | Promise<DataType>): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => {
        SetObjectConfigurableProperty(target, propertyKey, schema, fn)
        //The property is configured, not injected: an injection of the parents is removed
        RemoveObjectInjectItem(target, propertyKey)
    }
}
