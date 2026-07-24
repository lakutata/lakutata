import {DTO} from '../lib/core/DTO.js'
import {LoadObjectOptions} from './LoadObjectOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

@IndexSignature(LoadObjectOptions.Schema())
export class LoadNamedObjectOptions extends DTO {
    [id: string]: LoadObjectOptions
}
