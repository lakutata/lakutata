import {DTO} from '../../lib/core/DTO.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'
import {Schema} from 'joi'
import {SetObjectIndexSignatureSchema} from '../../lib/base/internal/ObjectSchemaValidation.js'

/**
 * Class Decorator
 * @param schema
 * @constructor
 */
export function IndexSignature<ClassConstructor extends typeof DTO>(schema: Schema): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => SetObjectIndexSignatureSchema(target, schema)
}
