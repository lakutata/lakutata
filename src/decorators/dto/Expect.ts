import {type DTO} from '../../lib/core/DTO.js'
import {type PropertyDecorator} from '../../types/PropertyDecorator.js'
import {SetObjectPropertySchema} from '../../lib/base/internal/ObjectSchemaValidation.js'
import {type Schema} from '../../lib/validation/types/Schema.js'

/**
 * Property Decorator
 * @param schema
 * @constructor
 */
export function Expect<ClassPrototype extends DTO>(schema: Schema): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectPropertySchema(target, propertyKey, schema)
}
