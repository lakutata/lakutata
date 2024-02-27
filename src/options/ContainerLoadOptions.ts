import {DTO} from '../lib/core/DTO.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {LoadObjectOptions} from './LoadObjectOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'

@IndexSignature(DTO.Alternatives(LoadObjectOptions.Schema(), DTO.Class(BaseObject)))
export class ContainerLoadOptions extends DTO {
    [name: string | symbol]: LoadObjectOptions | typeof BaseObject
}
