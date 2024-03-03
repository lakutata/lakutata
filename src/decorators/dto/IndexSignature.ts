import {DTO} from '../../lib/core/DTO.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'
import {SetObjectIndexSignatureSchema} from '../../lib/base/internal/ObjectSchemaValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Class Decorator
 * @param schema
 * @constructor
 */
export function IndexSignature<ClassConstructor extends typeof DTO>(schema: Schema): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => SetObjectIndexSignatureSchema(target, schema)
}
