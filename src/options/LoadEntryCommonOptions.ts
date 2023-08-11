import {DTO} from '../lib/base/DTO.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class LoadEntryCommonOptions extends DTO {

    /**
     * 需要传入的参数
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Any()).optional().default({}))
    public readonly config?: Record<string, any>

}
