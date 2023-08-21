import {DTO} from '../lib/base/DTO'
import {IndexSignature} from '../decorators/ValidationDecorators'
import {Validator} from '../exports/Validator'

@IndexSignature(Validator.Any())
export class LoadEntryCommonOptions extends DTO {
    /**
     * 需要传入的参数以索引签名的形式声明
     */
    [key: string]: any
}
