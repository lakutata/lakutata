import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectConfigurableProperty} from '../../lib/base/internal/ObjectConfiguration.js'
import {DTO} from '../../lib/core/DTO.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Property Decorator
 * @param schema
 * @param fn
 * @constructor
 */
export function Configurable<ClassPrototype extends BaseObject, DataType>(schema: Schema<DataType> = DTO.Any(), fn?: (value: DataType) => DataType | Promise<DataType>): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectConfigurableProperty(target, propertyKey, schema, fn)
}
