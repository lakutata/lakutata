import {DTO} from '../../lib/core/DTO.js'
import {TPropertyDecorator} from '../../types/TPropertyDecorator.js'
import {Schema} from 'joi'
import {SetObjectPropertySchema} from '../../lib/base/internal/ObjectSchemaValidation.js'

/**
 * Property Decorator
 * @param schema
 * @constructor
 */
export function Expect<ClassPrototype extends DTO>(schema: Schema): TPropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => SetObjectPropertySchema(target, propertyKey, schema)
}
