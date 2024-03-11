import {DTO} from '../lib/core/DTO.js'
import {OverridableObjectOptions} from './OverridableObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {BaseObject} from '../lib/base/BaseObject.js'

@IndexSignature(OverridableObjectOptions.Schema())
export class OverridableNamedObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {
    [id: string]: OverridableObjectOptions<ClassConstructor>
}
