import {DTO} from '../lib/core/DTO.js'
import {OverridableObjectOptions} from './OverridableObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {type BaseObject} from '../lib/base/BaseObject.js'
import {type IBaseObjectConstructor} from '../interfaces/IBaseObjectConstructor.js'

@IndexSignature(OverridableObjectOptions.Schema())
export class OverridableNamedObjectOptions<ClassConstructor extends IBaseObjectConstructor<BaseObject> = IBaseObjectConstructor<BaseObject>> extends DTO {
    [id: string]: OverridableObjectOptions<ClassConstructor>
}
