import {DTO} from '../lib/base/DTO.js'
import {IndexSignature} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

@IndexSignature(Validator.Any())
export class LoadEntryCommonOptions extends DTO {
    /**
     * 需要传入的参数以索引签名的形式声明
     */
    [key: string]: any
}
