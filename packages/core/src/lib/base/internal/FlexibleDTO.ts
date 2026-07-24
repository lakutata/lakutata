import {DTO} from '../../core/DTO.js'
import {IndexSignature} from '../../../decorators/dto/IndexSignature.js'

@IndexSignature(DTO.Any())
export class FlexibleDTO extends DTO {
    [prop: string]: any
}
