import {DTO} from '../../lib/dto/DTO.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {SetObjectIndexSignatureSchema} from '../../lib/dto/ObjectSchemaValidation.js'
import {Schema} from '../../lib/validation/types/Schema.js'

/**
 * Class Decorator
 * @param schema
 * @constructor
 */
export function IndexSignature<ClassConstructor extends typeof DTO>(schema: Schema): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => SetObjectIndexSignatureSchema(target, schema)
}
