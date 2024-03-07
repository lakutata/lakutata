import {DTO} from '../lib/core/DTO.js'
import {OverridableObjectOptions} from './OverridableObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

@IndexSignature(OverridableObjectOptions.Schema())
export class OverridableNamedObjectOptions extends DTO {
    [id: string]: OverridableObjectOptions
}
