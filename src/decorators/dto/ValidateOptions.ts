import {DTO} from '../../lib/core/DTO.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'
import {ValidationOptions} from 'joi'
import {SetObjectValidateOptions} from '../../lib/base/internal/ObjectSchemaValidation.js'

/**
 * Class Decorator
 * @param options
 * @constructor
 */
export function ValidateOptions<ClassConstructor extends typeof DTO>(options: ValidationOptions): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => SetObjectValidateOptions(target, options)
}